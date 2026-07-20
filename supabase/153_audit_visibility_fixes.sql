-- 153_audit_visibility_fixes.sql
-- Shahid feedback (20/07/2026):
--  Point 1: Pre-audit members (Fraz/Attia/Abdul Rehman) were seeing daily log
--   records for ALL companies. Fix: audit_daily_log_summary() now filters items
--   to only rows assigned to the calling member when the caller is not a manager
--   or admin/exec. Also tighten the audit_daily_approval_log write policy so
--   non-managers can only write entries for their assigned companies.
--  Point 2: audit_team_overview() now includes member_id in the viewer object
--   (used by the frontend to identify the current user; data restriction is
--   already correct at the RLS/fetch level in TasksList).

-- ─── Helper: is this company one the calling member is assigned to? ───────────
-- Used in the write RLS below. Returns true for managers/admin/exec always.
create or replace function is_assigned_audit_company(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    is_admin_or_exec()
    or (get_user_role() = 'Manager' and get_user_department() = 'Audit')
    or exists (
      select 1
        from audit_daily_activities da
        join members m on m.id = da.assigned_member_id
       where da.company_id = p_company_id
         and da.doc_type is not null
         and m.email = auth.email()
    );
$$;
grant execute on function is_assigned_audit_company(uuid) to authenticated;

-- ─── Tighten audit_daily_approval_log write RLS ───────────────────────────────
-- Read stays open for all Audit dept (manager + members need to see the full
-- picture). Write is now restricted to the member's assigned companies.
drop policy if exists "dept_access" on audit_daily_approval_log;

create policy "audit_log_read" on audit_daily_approval_log for select
  using (is_admin_or_exec() or get_user_department() = 'Audit');

create policy "audit_log_write" on audit_daily_approval_log
  for insert with check (is_assigned_audit_company(company_id));

create policy "audit_log_update" on audit_daily_approval_log
  for update using (is_assigned_audit_company(company_id))
             with check (is_assigned_audit_company(company_id));

-- ─── Updated audit_daily_log_summary() ───────────────────────────────────────
-- Non-managers now only see (and can write) rows assigned to them.
-- The aggregates (today_total, entered_count, expected_count) are also scoped
-- to the caller's rows so the header counts are meaningful.
-- yesterday_total and week sparkline are returned only for managers (the
-- executive dashboard widget always runs as admin/exec anyway).
create or replace function audit_daily_log_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_is_mgr   boolean := is_admin_or_exec()
                        or (get_user_role() = 'Manager' and get_user_department() = 'Audit');
  v_member_id uuid;
begin
  if not (is_admin_or_exec() or get_user_department() = 'Audit') then
    return jsonb_build_object('error', 'not_authorised');
  end if;

  -- Non-managers: resolve their own member_id to scope the query
  if not v_is_mgr then
    select id into v_member_id from members where email = auth.email() limit 1;
  end if;

  return (
    with expected as (
      -- Activities the calling member is responsible for.
      -- Managers see all; members see only rows assigned to them.
      select da.company_id, da.doc_type, da.activity,
             da.assigned_member_id,
             regexp_replace(m.name, '\s+', ' ', 'g') as assigned_name
        from audit_daily_activities da
        left join members m on m.id = da.assigned_member_id
       where da.doc_type is not null
         and (v_is_mgr or da.assigned_member_id = v_member_id)
    ),
    today as (
      select l.company_id, l.doc_type, l.pending_count, l.reason, l.recorded_by
        from audit_daily_approval_log l
       where l.log_date = current_date
    ),
    week as (
      select l.log_date, sum(l.pending_count) as total
        from audit_daily_approval_log l
       where l.log_date >= current_date - 6
       group by l.log_date
    )
    select jsonb_build_object(
      'as_of', current_date,

      -- Full item list (scoped by expected CTE above)
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
            'company_id', e.company_id,
            'doc_type',   e.doc_type,
            'activity',   e.activity,
            'assigned_member_id', e.assigned_member_id,
            'assigned_name',      e.assigned_name,
            'pending',      t.pending_count,
            'reason',       t.reason,
            'recorded_by',  t.recorded_by,
            'entered',      t.pending_count is not null
          ) order by e.company_id, e.doc_type)
          from expected e
          left join today t on t.company_id = e.company_id and t.doc_type = e.doc_type
      ), '[]'::jsonb),

      -- Totals are scoped to the caller's expected rows
      'today_total', coalesce((
        select sum(t.pending_count)
          from expected e
          join today t on t.company_id = e.company_id and t.doc_type = e.doc_type
      ), 0),
      'entered_count', (
        select count(*)
          from expected e
         where exists (
           select 1 from today t
            where t.company_id = e.company_id and t.doc_type = e.doc_type
         )
      ),
      'expected_count', (select count(*) from expected),

      -- Yesterday total and week sparkline: managers/exec only
      'yesterday_total', case when v_is_mgr then
        coalesce((
          select sum(pending_count)
            from audit_daily_approval_log
           where log_date = current_date - 1
        ), null)
      else null end,

      'week', case when v_is_mgr then
        coalesce((
          select jsonb_agg(jsonb_build_object('date', w.log_date, 'total', w.total) order by w.log_date)
            from week w
        ), '[]'::jsonb)
      else '[]'::jsonb end
    )
  );
end $$;
grant execute on function audit_daily_log_summary() to authenticated;

-- ─── Updated audit_team_overview(): add member_id to viewer object ─────────────
create or replace function audit_team_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_email     text    := auth.email();
  v_is_mgr    boolean := is_audit_manager();
  v_team      uuid;
  v_member_id uuid;
  result      jsonb;
begin
  -- Resolve the caller's member record and team in one shot
  select m.id, atm.team_id
    into v_member_id, v_team
    from members m
    left join audit_team_members atm on atm.member_id = m.id
   where m.email = v_email
   limit 1;

  if not (v_is_mgr or get_user_department() = 'Audit' or is_admin_or_exec()) then
    return jsonb_build_object('error', 'not_authorised');
  end if;

  with vis_teams as (
    select t.* from audit_teams t
    where v_is_mgr or t.id = v_team
  ),
  task_calc as (
    select tk.id, tk.process_id, tk.stage_no, tk.status, tk.sub_task, tk.stage_label,
           tk.responsible, tk.responsible_2, tk.total_days, tk.started_at, tk.updated_at,
           p.company_id, p.process_name,
           atc.team_id,
           case when tk.status = 'In Progress' and tk.started_at is not null
                then ceil(extract(epoch from now() - tk.started_at) / 86400.0)::int end as days_in,
           case when tk.status = 'In Progress' and tk.updated_at < now() - interval '5 days'
                then floor(extract(epoch from now() - tk.updated_at) / 86400.0)::int end as idle_days
    from audit_stage_tasks tk
    join audit_plan_processes p on p.id = tk.process_id
    join audit_team_companies atc on atc.company_id = p.company_id
    where atc.team_id in (select id from vis_teams)
  ),
  stuck as (
    select team_id, process_id, process_name, company_id, stage_no, stage_label, sub_task,
           coalesce(responsible, '') || case when responsible_2 is not null then ' + ' || responsible_2 else '' end as who,
           days_in, total_days,
           greatest(coalesce(days_in, 0) - coalesce(total_days, 0), 0) as over_days,
           idle_days
    from task_calc
    where status = 'In Progress'
      and (coalesce(days_in, 0) > coalesce(total_days, 0) or idle_days is not null)
  ),
  proc as (
    select p.id, p.company_id, atc.team_id, p.s_no, p.process_name, p.frequency,
           p.period_label, p.status, p.status_note, p.target_date,
           p.next_period_label, p.next_target_date,
           coalesce(a.total_days, 0) as total_days,
           coalesce(a.done_days, 0) as done_days,
           a.current_stage_no,
           a.started_on,
           coalesce(a.stuck_count, 0) as stuck_count,
           case when p.status = 'Completed' then 100
                when coalesce(a.total_days, 0) > 0 then round(100.0 * coalesce(a.done_days, 0) / a.total_days)::int
                else 0 end as completion_pct
    from audit_plan_processes p
    join audit_team_companies atc on atc.company_id = p.company_id
    left join lateral (
      select sum(coalesce(t.total_days, 0)) as total_days,
             sum(coalesce(t.total_days, 0)) filter (where t.status = 'Completed') as done_days,
             min(t.stage_no) filter (where t.status <> 'Completed') as current_stage_no,
             min(t.started_at)::date as started_on,
             count(*) filter (where t.status = 'In Progress' and
               (coalesce(ceil(extract(epoch from now() - t.started_at) / 86400.0)::int, 0) > coalesce(t.total_days, 0)
                or t.updated_at < now() - interval '5 days')) as stuck_count
      from audit_stage_tasks t where t.process_id = p.id
    ) a on true
    where atc.team_id in (select id from vis_teams)
  )
  select jsonb_build_object(
    -- member_id added so the frontend can identify the current user
    'viewer', jsonb_build_object('is_manager', v_is_mgr, 'team_id', v_team, 'member_id', v_member_id),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', vt.id, 'code', vt.code, 'name', vt.name, 'sort_order', vt.sort_order,
        'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', regexp_replace(m.name, '\s+', ' ', 'g')) order by m.name)
                    from audit_team_members atm join members m on m.id = atm.member_id where atm.team_id = vt.id), '[]'::jsonb),
        'company_ids', coalesce((select jsonb_agg(atc.company_id) from audit_team_companies atc where atc.team_id = vt.id), '[]'::jsonb),
        'done', (select count(*) from proc where proc.team_id = vt.id and proc.status = 'Completed'),
        'running', (select count(*) from proc where proc.team_id = vt.id and proc.status = 'In Progress'),
        'total', (select count(*) from proc where proc.team_id = vt.id),
        'stuck', (select count(*) from stuck where stuck.team_id = vt.id),
        'overdue', (select count(*) from proc where proc.team_id = vt.id and proc.status in ('Planned','In Progress') and proc.target_date < current_date),
        'next_target', (select min(proc.target_date) from proc where proc.team_id = vt.id and proc.status in ('Planned','In Progress') and proc.target_date >= current_date)
      ) order by vt.sort_order) from vis_teams vt), '[]'::jsonb),
    'stuck', coalesce((select jsonb_agg(to_jsonb(s) order by s.over_days desc nulls last) from stuck s), '[]'::jsonb),
    'processes', coalesce((select jsonb_agg(to_jsonb(pr) order by pr.company_id, pr.s_no) from proc pr), '[]'::jsonb),
    'audit_members', case when v_is_mgr then coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'name', regexp_replace(m.name, '\s+', ' ', 'g'),
             'team_id', atm.team_id) order by m.name)
      from members m left join audit_team_members atm on atm.member_id = m.id
      where m.department = 'Audit' and m.is_active and m.role <> 'Manager'), '[]'::jsonb) else '[]'::jsonb end
  ) into result;

  return result;
end $$;
grant execute on function audit_team_overview() to authenticated;
