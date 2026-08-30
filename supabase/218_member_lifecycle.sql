-- 218: Member lifecycle automation (FlowHCM drives app access)
-- ─────────────────────────────────────────────────────────────────
-- When a linked employee leaves in FlowHCM → their app account is
-- deactivated automatically (is_active=false — reversible, never deleted).
-- Manager hierarchy syncs from FlowHCM reports_to when the name resolves
-- to exactly ONE active linked member; ambiguous names are logged, not
-- guessed. Every action is recorded in flw_lifecycle_events.
-- members.lifecycle_exempt=true opts an account out of auto-deactivation
-- (e.g. someone who left employment but keeps app access).
-- ─────────────────────────────────────────────────────────────────

alter table members add column if not exists lifecycle_exempt boolean default false;

create table if not exists flw_lifecycle_events (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid references members(id),
  employee_code text,
  event_type    text not null,   -- 'deactivated' | 'manager_updated' | 'manager_ambiguous' | 'left_but_exempt'
  detail        text,
  created_at    timestamptz default now()
);
alter table flw_lifecycle_events enable row level security;
do $pol$ begin
  if not exists (select 1 from pg_policies where tablename = 'flw_lifecycle_events' and policyname = 'lifecycle_admin_read') then
    create policy lifecycle_admin_read on flw_lifecycle_events for select using (is_admin_tier());
  end if;
end $pol$;

create or replace function sync_member_lifecycle()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 1. Deactivate app accounts of employees who left (unless exempt)
  with leavers as (
    select m.id, m.employee_code, e.leaving_date
    from members m
    join flw_employees e on e.employee_code = m.employee_code
    where m.is_active and not coalesce(m.lifecycle_exempt, false) and e.is_active = false
  ),
  logged as (
    insert into flw_lifecycle_events (member_id, employee_code, event_type, detail)
    select id, employee_code, 'deactivated',
           'FlowHCM shows employee left' || coalesce(' on ' || to_char(leaving_date, 'DD/MM/YYYY'), '')
    from leavers
    returning member_id
  )
  update members set is_active = false where id in (select member_id from logged);

  -- 2. Log exempt leavers (visible but untouched)
  insert into flw_lifecycle_events (member_id, employee_code, event_type, detail)
  select m.id, m.employee_code, 'left_but_exempt', 'Employee left in FlowHCM but account is lifecycle-exempt'
  from members m
  join flw_employees e on e.employee_code = m.employee_code
  where m.is_active and coalesce(m.lifecycle_exempt, false) and e.is_active = false
    and not exists (
      select 1 from flw_lifecycle_events ev
      where ev.member_id = m.id and ev.event_type = 'left_but_exempt'
        and ev.created_at > now() - interval '7 days');

  -- 3. Manager sync: FlowHCM reports_to → members.manager_id, only when the
  --    name resolves to exactly one ACTIVE employee linked to an active member
  with resolution as (
    select m.id as member_id, m.manager_id as current_mgr, m.employee_code,
           e.reports_to,
           (select min(m2.id::text)::uuid from flw_employees e2
              join members m2 on m2.employee_code = e2.employee_code and m2.is_active
              where e2.full_name = e.reports_to and e2.is_active) as new_mgr,
           (select count(distinct m2.id) from flw_employees e2
              join members m2 on m2.employee_code = e2.employee_code and m2.is_active
              where e2.full_name = e.reports_to and e2.is_active) as n_candidates
    from members m
    join flw_employees e on e.employee_code = m.employee_code
    where m.is_active and e.is_active and e.reports_to is not null
  ),
  updates as (
    select * from resolution
    where n_candidates = 1 and new_mgr is not null
      and new_mgr is distinct from current_mgr and new_mgr != member_id
  ),
  logged2 as (
    insert into flw_lifecycle_events (member_id, employee_code, event_type, detail)
    select member_id, employee_code, 'manager_updated',
           'Manager set from FlowHCM reports_to: ' || reports_to
    from updates
    returning member_id
  )
  update members m set manager_id = u.new_mgr
  from updates u where m.id = u.member_id;
end;
$$;
