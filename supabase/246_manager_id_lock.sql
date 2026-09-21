-- 246: Add manager_id_locked to protect manually-set manager assignments
-- ──────────────────────────────────────────────────────────────────────
-- Bug 4 / Bug 6 root cause:
--   sync_member_lifecycle() updates members.manager_id based on
--   FlowHCM's "reports_to" name string. If FlowHCM has the wrong manager
--   name (e.g. "Sundas" instead of "Kamran" for Rimsha), the app's task
--   routing silently sends submitted tasks to the wrong person.
--
-- Fix:
--   Add manager_id_locked boolean. When true, sync_member_lifecycle skips
--   the manager_id update for that member and logs it instead.
--   Admins set manager_id_locked = true via the Members page for anyone
--   whose FlowHCM data is unreliable.
--
-- Note: lifecycle_exempt ONLY guards is_active from auto-deactivation.
-- It does NOT and should NOT guard manager_id — these are separate
-- concerns. A member can be lifecycle_exempt but still want their
-- manager synced from FlowHCM.
-- ──────────────────────────────────────────────────────────────────────

-- 1. Add the lock column
alter table members
  add column if not exists manager_id_locked boolean default false;

comment on column members.manager_id_locked is
  'When true, FlowHCM sync will not overwrite manager_id. Set manually via admin UI for members whose FlowHCM reports_to data is incorrect.';

-- 2. Add the new event_type value to the lifecycle log
-- (event_type is a plain text column — no enum — so no migration needed,
--  the new value just needs to be documented here.)

-- 3. Replace sync_member_lifecycle to honour manager_id_locked
create or replace function sync_member_lifecycle()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- ── Step 1: Deactivate app accounts of employees who left (unless exempt) ──
  with leavers as (
    select m.id, m.employee_code, e.leaving_date
    from members m
    join flw_employees e on e.employee_code = m.employee_code
    where m.is_active
      and not coalesce(m.lifecycle_exempt, false)
      and e.is_active = false
  ),
  logged as (
    insert into flw_lifecycle_events (member_id, employee_code, event_type, detail)
    select id, employee_code, 'deactivated',
           'FlowHCM shows employee left' ||
           coalesce(' on ' || to_char(leaving_date, 'DD/MM/YYYY'), '')
    from leavers
    returning member_id
  )
  update members set is_active = false
  where id in (select member_id from logged);

  -- ── Step 2: Log exempt leavers (visible but untouched) ──
  insert into flw_lifecycle_events (member_id, employee_code, event_type, detail)
  select m.id, m.employee_code,
         'left_but_exempt',
         'Employee left in FlowHCM but account is lifecycle-exempt'
  from members m
  join flw_employees e on e.employee_code = m.employee_code
  where m.is_active
    and coalesce(m.lifecycle_exempt, false)
    and e.is_active = false
    and not exists (
      select 1 from flw_lifecycle_events ev
      where ev.member_id = m.id
        and ev.event_type = 'left_but_exempt'
        and ev.created_at > now() - interval '7 days');

  -- ── Step 3: Manager sync ──
  --    Resolves FlowHCM reports_to name → members.manager_id only when:
  --    a) The name matches exactly ONE active linked member, AND
  --    b) manager_id_locked is false (or null) for that member.
  --    When locked, logs a 'manager_update_skipped_locked' event instead.
  with resolution as (
    select m.id                  as member_id,
           m.manager_id          as current_mgr,
           m.employee_code,
           m.manager_id_locked,
           e.reports_to,
           ( select min(m2.id::text)::uuid
             from flw_employees e2
             join members m2 on m2.employee_code = e2.employee_code
                             and m2.is_active
             where e2.full_name = e.reports_to
               and e2.is_active
           )                     as new_mgr,
           ( select count(distinct m2.id)
             from flw_employees e2
             join members m2 on m2.employee_code = e2.employee_code
                             and m2.is_active
             where e2.full_name = e.reports_to
               and e2.is_active
           )                     as n_candidates
    from members m
    join flw_employees e on e.employee_code = m.employee_code
    where m.is_active
      and e.is_active
      and e.reports_to is not null
  ),
  -- Members we WOULD update but are locked
  skip_locked as (
    select * from resolution
    where n_candidates = 1
      and new_mgr is not null
      and new_mgr is distinct from current_mgr
      and new_mgr != member_id
      and coalesce(manager_id_locked, false) = true
  ),
  _log_skipped as (
    insert into flw_lifecycle_events (member_id, employee_code, event_type, detail)
    select member_id, employee_code,
           'manager_update_skipped_locked',
           'FlowHCM reports_to resolved to ' || reports_to ||
           ' but manager_id_locked=true — manual assignment preserved'
    from skip_locked
    returning member_id
  ),
  -- Members eligible for the update
  updates as (
    select * from resolution
    where n_candidates = 1
      and new_mgr is not null
      and new_mgr is distinct from current_mgr
      and new_mgr != member_id
      and coalesce(manager_id_locked, false) = false
  ),
  logged2 as (
    insert into flw_lifecycle_events (member_id, employee_code, event_type, detail)
    select member_id, employee_code, 'manager_updated',
           'Manager set from FlowHCM reports_to: ' || reports_to
    from updates
    returning member_id
  )
  update members m
  set manager_id = u.new_mgr
  from updates u
  where m.id = u.member_id;

  -- ── Step 4: Log ambiguous names (multiple matches) ──
  with ambiguous as (
    select m.id as member_id, m.employee_code, e.reports_to,
           ( select count(distinct m2.id)
             from flw_employees e2
             join members m2 on m2.employee_code = e2.employee_code and m2.is_active
             where e2.full_name = e.reports_to and e2.is_active
           ) as n_candidates
    from members m
    join flw_employees e on e.employee_code = m.employee_code
    where m.is_active and e.is_active and e.reports_to is not null
  )
  insert into flw_lifecycle_events (member_id, employee_code, event_type, detail)
  select member_id, employee_code, 'manager_ambiguous',
         'FlowHCM reports_to "' || reports_to || '" matched ' ||
         n_candidates || ' active members — skipped'
  from ambiguous
  where n_candidates > 1
    and not exists (
      select 1 from flw_lifecycle_events ev
      where ev.member_id = ambiguous.member_id
        and ev.event_type = 'manager_ambiguous'
        and ev.created_at > now() - interval '7 days');

end;
$$;
