-- 280_audit_page_access.sql
-- Audit page (/department/audit) — access fix, 19/10/2026.
--
-- WHY: the Internal Audit team's department was renamed from 'Audit' to
-- 'Internal Audit' (members clean-up 18/10/2026). Every audit RLS policy,
-- helper and RPC still compared get_user_department() = 'Audit', so the whole
-- team (incl. Shahid, Manager) silently lost the page, the home Audit cards and
-- the Tasks panel. Daily pre-audit entry also required an activity assignment
-- that no row has, so only managers could save.
--
-- WHAT:
--   1. is_internal_audit_member()  — department 'Internal Audit' (or legacy
--      'Audit'), admin tier, or service role.
--   2. is_pre_audit_member()       — member of the PREAUDIT audit team.
--   3. is_audit_manager() / is_assigned_audit_company() re-pointed; pre-audit
--      members may record daily counts for any company (assignment optional).
--   4. 10 RLS policies ALTERed (no DROP) to use is_internal_audit_member().
--   5. 5 RPCs re-pointed; audit_daily_log_summary shows all activities to a
--      member with no assignments and uses the Pakistan date (DB runs in UTC);
--      audit_members list uses the new department.
-- Apply in Supabase SQL Editor. Rollback section at the bottom.

-- 1. Helpers -----------------------------------------------------------------
create or replace function public.is_internal_audit_member()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    is_admin_or_exec()
    or (auth.jwt() ->> 'role') = 'service_role'
    or get_user_department() in ('Internal Audit', 'Audit'),
    false);
$$;
revoke all on function public.is_internal_audit_member() from public;
grant execute on function public.is_internal_audit_member() to authenticated, service_role;

create or replace function public.is_pre_audit_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from audit_team_members atm
      join audit_teams t on t.id = atm.team_id
      join members m on m.id = atm.member_id
     where t.code = 'PREAUDIT'
       and m.is_active
       and lower(m.email) = lower(auth.email())
  );
$$;
revoke all on function public.is_pre_audit_member() from public;
grant execute on function public.is_pre_audit_member() to authenticated, service_role;

create or replace function public.is_audit_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin_or_exec()
      or (auth.jwt() ->> 'role') = 'service_role'
      or (get_user_role() = 'Manager' and get_user_department() in ('Internal Audit', 'Audit'));
$$;

create or replace function public.is_assigned_audit_company(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    is_audit_manager()
    or is_pre_audit_member()
    or exists (
      select 1
        from audit_daily_activities da
        join members m on m.id = da.assigned_member_id
       where da.company_id = p_company_id
         and da.doc_type is not null
         and lower(m.email) = lower(auth.email())
    );
$$;

-- 2. RLS policies (ALTER keeps the policy, only the expression changes) -------
alter policy dept_read      on public.audit_daily_activities  using (is_internal_audit_member());
alter policy audit_log_read on public.audit_daily_approval_log using (is_internal_audit_member());
alter policy dept_access    on public.audit_findings          using (is_internal_audit_member()) with check (is_internal_audit_member());
alter policy dept_access    on public.audit_plan_items        using (is_internal_audit_member()) with check (is_internal_audit_member());
alter policy dept_access    on public.audit_plan_processes    using (is_internal_audit_member()) with check (is_internal_audit_member());
alter policy dept_access    on public.audit_stage_tasks       using (is_internal_audit_member()) with check (is_internal_audit_member());
alter policy dept_read      on public.audit_stage_templates   using (is_internal_audit_member());
alter policy audit_read     on public.audit_team_companies    using (is_internal_audit_member());
alter policy audit_read     on public.audit_team_members      using (is_internal_audit_member());
alter policy audit_read     on public.audit_teams             using (is_internal_audit_member());

-- 3. RPCs -------------------------------------------------------------------
-- audit_executive_summary, audit_my_tasks, audit_start_new_cycle: only the
-- guard line changes. audit_team_overview: guard + audit_members department.
-- audit_daily_log_summary: guard + manager test + unassigned members see all.
-- (Full bodies are CREATE OR REPLACEd below with those edits only.)

create or replace function public.audit_executive_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare
  result jsonb;
begin
  if not is_internal_audit_member() then
    return jsonb_build_object('error', 'not_authorised');
  end if;

  with proc_stats as (
    select
      p.id, p.status, p.target_date,
      atc.team_id,
      case
        when p.status = 'Completed' then 100
        when coalesce(agg.total_days, 0) > 0
          then round(100.0 * coalesce(agg.done_days, 0) / agg.total_days)::int
        when coalesce(agg.total_stages, 0) > 0
          then round(100.0 * coalesce(agg.done_stages, 0) / agg.total_stages)::int
        else 0
      end as pct
    from audit_plan_processes p
    join audit_team_companies atc on atc.company_id = p.company_id
    left join lateral (
      select
        sum(coalesce(t.total_days, 0))                                       as total_days,
        sum(coalesce(t.total_days, 0)) filter (where t.status = 'Completed') as done_days,
        count(*)                                                               as total_stages,
        count(*) filter (where t.status = 'Completed')                        as done_stages
      from audit_stage_tasks t
      where t.process_id = p.id
    ) agg on true
    where p.status <> 'Cancelled'
  ),
  team_agg as (
    select
      t.id, t.name, t.code, t.sort_order,
      count(*)                                                                   as total,
      count(*) filter (where ps.status = 'Completed')                            as done,
      count(*) filter (where ps.status = 'In Progress')                          as running,
      count(*) filter (where ps.status = 'Planned')                              as planned,
      count(*) filter (where ps.status in ('Planned','In Progress')
                         and ps.target_date is not null
                         and ps.target_date < current_date)                      as overdue,
      count(*) filter (where ps.status = 'In Progress'
                         and (ps.target_date is null or ps.target_date >= current_date)) as on_track,
      round(coalesce(avg(ps.pct), 0))::int                                       as avg_pct,
      min(ps.target_date) filter (where ps.status in ('Planned','In Progress')
                                    and ps.target_date >= current_date)          as next_deadline
    from audit_teams t
    -- Join proc_stats directly — do NOT re-join audit_team_companies here
    -- (it would multiply rows by the number of companies in the team).
    join proc_stats ps on ps.team_id = t.id
    where t.code <> 'PREAUDIT'
    group by t.id, t.name, t.code, t.sort_order
  )
  select jsonb_build_object(
    'overall', (
      select jsonb_build_object(
        'total',    sum(total),
        'done',     sum(done),
        'running',  sum(running),
        'planned',  sum(planned),
        'overdue',  sum(overdue),
        'on_track', sum(on_track),
        'avg_pct',  round(coalesce(avg(avg_pct), 0))::int
      )
      from team_agg
    ),
    'teams', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',            ta.id,
          'name',          ta.name,
          'code',          ta.code,
          'total',         ta.total,
          'done',          ta.done,
          'running',       ta.running,
          'planned',       ta.planned,
          'overdue',       ta.overdue,
          'on_track',      ta.on_track,
          'avg_pct',       ta.avg_pct,
          'next_deadline', ta.next_deadline
        ) order by ta.sort_order
      )
      from team_agg ta
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$;

create or replace function public.audit_start_new_cycle(p_process_id uuid, p_period_label text default null, p_target_date date default null)
returns void language plpgsql security definer set search_path = public as $function$
begin
  if not is_internal_audit_member() then
    raise exception 'Not authorised';
  end if;
  update audit_stage_tasks set status = 'Not Started', completed_at = null, updated_at = now()
   where process_id = p_process_id;
  update audit_plan_processes
     set status = 'Planned',
         period_label = coalesce(p_period_label, next_period_label, period_label),
         target_date = coalesce(p_target_date, next_target_date, target_date),
         next_period_label = null,
         next_target_date = null,
         updated_at = now()
   where id = p_process_id;
end $function$;

create or replace function public.audit_my_tasks()
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare
  v_email       text := auth.email();
  v_team_id     uuid;
  v_team_name   text;
  v_member_name text;
  v_projects    jsonb;
begin
  if not is_internal_audit_member() then
    return jsonb_build_object('error', 'not_authorised');
  end if;

  select atm.team_id, at.name, regexp_replace(m.name, '\s+', ' ', 'g')
    into v_team_id, v_team_name, v_member_name
    from members m
    join audit_team_members atm on atm.member_id = m.id
    join audit_teams        at  on at.id = atm.team_id
   where lower(m.email) = lower(v_email)
   limit 1;

  if v_team_id is null then
    return jsonb_build_object('projects', '[]'::jsonb, 'team_name', null::text);
  end if;

  -- Pre-audit path
  if v_team_name like 'Pre-audit%' then
    select coalesce(jsonb_agg(proj order by proj->>'company_id', (proj->>'s_no')::int), '[]'::jsonb)
      into v_projects
      from (
        select jsonb_build_object(
          'id',           p.id,
          's_no',         p.s_no,
          'process_name', p.process_name,
          'company_id',   p.company_id,
          'period_label', p.period_label,
          'status',       p.status,
          'status_note',  p.status_note,
          'target_date',  p.target_date,
          'total_days',   0,
          'done_days',    0,
          'completion_pct', case
            when p.status = 'Completed' then 100
            else coalesce((
              select sum(case sg.sn when 1 then 5 when 2 then 10 when 3 then 40
                         when 4 then 20 when 5 then 10 when 6 then 9 when 7 then 5 when 8 then 1 else 0 end)
              from (
                select stage_no as sn, bool_and(status = 'Completed') as all_done
                from audit_stage_tasks where process_id = p.id group by stage_no
              ) sg where sg.all_done
            ), 0)
          end,
          'stages', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', t.id, 'stage_no', t.stage_no, 'stage_label', t.stage_label,
              'sub_task', t.sub_task, 'responsible', t.responsible,
              'responsible_2', t.responsible_2, 'total_days', t.total_days,
              'status', t.status, 'started_at', t.started_at,
              'completed_at', t.completed_at, 'sort_order', t.sort_order
            ) order by t.stage_no, t.sort_order)
            from audit_stage_tasks t where t.process_id = p.id
          ), '[]'::jsonb)
        ) as proj
          from audit_plan_processes p
         where exists (
           select 1 from audit_stage_tasks t2
            where t2.process_id = p.id
              and (v_member_name ilike '%' || t2.responsible || '%'
                   or (t2.responsible_2 is not null
                       and v_member_name ilike '%' || t2.responsible_2 || '%'))
         )
      ) sub;

    return jsonb_build_object('team_name', v_team_name, 'projects', v_projects);
  end if;

  -- Post-audit path
  select coalesce(jsonb_agg(proj order by proj->>'company_id', (proj->>'s_no')::int), '[]'::jsonb)
    into v_projects
    from (
      select jsonb_build_object(
        'id',           p.id,
        's_no',         p.s_no,
        'process_name', p.process_name,
        'company_id',   p.company_id,
        'period_label', p.period_label,
        'status',       p.status,
        'status_note',  p.status_note,
        'target_date',  p.target_date,
        'total_days',   0,
        'done_days',    0,
        'completion_pct', case
          when p.status = 'Completed' then 100
          else coalesce((
            select sum(case sg.sn when 1 then 5 when 2 then 10 when 3 then 40
                       when 4 then 20 when 5 then 10 when 6 then 9 when 7 then 5 when 8 then 1 else 0 end)
            from (
              select stage_no as sn, bool_and(status = 'Completed') as all_done
              from audit_stage_tasks where process_id = p.id group by stage_no
            ) sg where sg.all_done
          ), 0)
        end,
        'stages', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id, 'stage_no', t.stage_no, 'stage_label', t.stage_label,
            'sub_task', t.sub_task, 'responsible', t.responsible,
            'responsible_2', t.responsible_2, 'total_days', t.total_days,
            'status', t.status, 'started_at', t.started_at,
            'completed_at', t.completed_at, 'sort_order', t.sort_order
          ) order by t.stage_no, t.sort_order)
          from audit_stage_tasks t where t.process_id = p.id
        ), '[]'::jsonb)
      ) as proj
        from audit_plan_processes p
        join audit_team_companies atc
          on atc.company_id = p.company_id and atc.team_id = v_team_id
    ) sub;

  return jsonb_build_object('team_name', v_team_name, 'projects', v_projects);
end $function$;

create or replace function public.audit_daily_log_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare
  v_is_mgr    boolean := is_audit_manager();
  v_member_id uuid;
  v_scoped    boolean := false;   -- true only when the member has explicit assignments
  v_today     date    := (now() at time zone 'Asia/Karachi')::date;  -- team works in PKT; DB is UTC
begin
  if not is_internal_audit_member() then
    return jsonb_build_object('error', 'not_authorised');
  end if;

  if not v_is_mgr then
    select id into v_member_id from members where lower(email) = lower(auth.email()) limit 1;
    -- Members with assignments see only their rows; everyone else sees all
    -- activities (assignment is optional — 19/10/2026).
    select exists (
      select 1 from audit_daily_activities
       where assigned_member_id = v_member_id and doc_type is not null
    ) into v_scoped;
  end if;

  return (
    with expected as (
      select da.company_id, da.doc_type, da.activity,
             da.assigned_member_id,
             regexp_replace(m.name, '\s+', ' ', 'g') as assigned_name
        from audit_daily_activities da
        left join members m on m.id = da.assigned_member_id
       where da.doc_type is not null
         and (not v_scoped or da.assigned_member_id = v_member_id)
    ),
    today as (
      select l.company_id, l.doc_type, l.pending_count, l.reason, l.recorded_by
        from audit_daily_approval_log l
       where l.log_date = v_today
    ),
    week as (
      select l.log_date, sum(l.pending_count) as total
        from audit_daily_approval_log l
       where l.log_date >= v_today - 6
       group by l.log_date
    )
    select jsonb_build_object(
      'as_of', v_today,
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
      'yesterday_total', case when v_is_mgr then
        coalesce((
          select sum(pending_count)
            from audit_daily_approval_log
           where log_date = v_today - 1
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
end $function$;

create or replace function public.audit_team_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare
  v_email       text    := auth.email();
  v_is_mgr      boolean := is_audit_manager();
  v_team        uuid;
  v_member_id   uuid;
  v_member_name text;
  result        jsonb;
begin
  select m.id, atm.team_id, regexp_replace(m.name, '\s+', ' ', 'g')
    into v_member_id, v_team, v_member_name
    from members m
    left join audit_team_members atm on atm.member_id = m.id
   where lower(m.email) = lower(v_email)
   limit 1;

  if not (v_is_mgr or is_internal_audit_member()) then
    return jsonb_build_object('error', 'not_authorised');
  end if;

  with vis_teams as (
    select t.* from audit_teams t
    where v_is_mgr or t.id = v_team
  ),
  stage_w(sn, w) as (
    values (1,5),(2,10),(3,40),(4,20),(5,10),(6,9),(7,5),(8,1)
  ),
  task_calc as (
    select tk.id, tk.process_id, tk.stage_no, tk.status,
           tk.sub_task, tk.stage_label, tk.responsible, tk.responsible_2,
           p.company_id, p.process_name,
           atc.team_id,
           case when tk.status = 'In Progress'
                     and tk.updated_at < now() - interval '5 days'
                then floor(extract(epoch from now() - tk.updated_at) / 86400.0)::int
           end as idle_days
    from audit_stage_tasks tk
    join audit_plan_processes p on p.id = tk.process_id
    join audit_team_companies atc on atc.company_id = p.company_id
    where atc.team_id in (select id from vis_teams)
  ),
  stuck as (
    select team_id, process_id, process_name, company_id, stage_no, stage_label,
           sub_task,
           coalesce(responsible, '') ||
             case when responsible_2 is not null then ' + ' || responsible_2 else '' end as who,
           idle_days
    from task_calc
    where status = 'In Progress' and idle_days is not null
  ),
  proc as (
    select p.id, p.company_id, atc.team_id, p.s_no, p.process_name, p.frequency,
           p.period_label, p.status, p.status_note, p.target_date,
           p.next_period_label, p.next_target_date,
           a.completion_pct,
           a.current_stage_no,
           a.started_on,
           a.stuck_count
    from audit_plan_processes p
    join audit_team_companies atc on atc.company_id = p.company_id
    left join lateral (
      select
        case when p.status = 'Completed' then 100
             else coalesce((
               select sum(sw.w)
               from (
                 select stage_no, bool_and(status = 'Completed') as all_done
                 from audit_stage_tasks where process_id = p.id
                 group by stage_no
               ) sg
               join stage_w sw on sw.sn = sg.stage_no
               where sg.all_done
             ), 0)
        end as completion_pct,
        (select min(stage_no) from audit_stage_tasks
          where process_id = p.id and status <> 'Completed') as current_stage_no,
        (select min(started_at)::date from audit_stage_tasks
          where process_id = p.id) as started_on,
        (select count(*) from audit_stage_tasks
          where process_id = p.id
            and status = 'In Progress'
            and updated_at < now() - interval '5 days') as stuck_count
    ) a on true
    where atc.team_id in (select id from vis_teams)
  )
  select jsonb_build_object(
    'viewer', jsonb_build_object(
      'is_manager', v_is_mgr,
      'team_id', v_team,
      'member_id', v_member_id,
      'member_company_ids', case
        when v_is_mgr or is_admin_or_exec() or v_team is null or v_member_id is null
          then '[]'::jsonb
        when (select code from audit_teams where id = v_team) = 'PREAUDIT'
          then coalesce((
            select jsonb_agg(distinct p2.company_id order by p2.company_id)
              from audit_stage_tasks t2
              join audit_plan_processes p2 on p2.id = t2.process_id
             where v_member_name ilike '%' || t2.responsible || '%'
          ), '[]'::jsonb)
        else coalesce((
          select jsonb_agg(atc2.company_id order by atc2.company_id)
            from audit_team_companies atc2 where atc2.team_id = v_team
        ), '[]'::jsonb)
      end
    ),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', vt.id, 'code', vt.code, 'name', vt.name, 'sort_order', vt.sort_order,
        'members', coalesce((
          select jsonb_agg(jsonb_build_object('id', m.id, 'name', regexp_replace(m.name, '\s+', ' ', 'g')) order by m.name)
          from audit_team_members atm join members m on m.id = atm.member_id where atm.team_id = vt.id
        ), '[]'::jsonb),
        'company_ids', coalesce((
          select jsonb_agg(atc.company_id) from audit_team_companies atc where atc.team_id = vt.id
        ), '[]'::jsonb),
        'done',    (select count(*) from proc where proc.team_id = vt.id and proc.status = 'Completed'),
        'running', (select count(*) from proc where proc.team_id = vt.id and proc.status = 'In Progress'),
        'total',   (select count(*) from proc where proc.team_id = vt.id),
        'stuck',   (select count(*) from stuck where stuck.team_id = vt.id),
        'overdue', (select count(*) from proc where proc.team_id = vt.id
                    and proc.status in ('Planned','In Progress') and proc.target_date < current_date),
        'next_target', (select min(proc.target_date) from proc where proc.team_id = vt.id
                        and proc.status in ('Planned','In Progress') and proc.target_date >= current_date)
      ) order by vt.sort_order) from vis_teams vt
    ), '[]'::jsonb),
    'stuck', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.idle_days desc nulls last) from stuck s
    ), '[]'::jsonb),
    'processes', coalesce((
      select jsonb_agg(to_jsonb(pr) order by pr.company_id, pr.s_no) from proc pr
    ), '[]'::jsonb),
    'audit_members', case when v_is_mgr then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'name', regexp_replace(m.name, '\s+', ' ', 'g'),
        'team_id', atm.team_id
      ) order by m.name)
      from members m left join audit_team_members atm on atm.member_id = m.id
      where m.department in ('Internal Audit', 'Audit') and m.is_active and m.role <> 'Manager'
        and m.email not like 'test.%@unze.co.uk'
    ), '[]'::jsonb) else '[]'::jsonb end
  ) into result;

  return result;
end $function$;

-- ROLLBACK (manual) ------------------------------------------------------------
-- To revert: re-run the previous definitions from the Supabase function history,
-- or change every is_internal_audit_member() above back to
--   (is_admin_or_exec() or get_user_department() = 'Audit')
-- in the 10 ALTER POLICY statements and the 5 RPC guards, restore
-- is_audit_manager / is_assigned_audit_company without the 'Internal Audit' /
-- is_pre_audit_member() clauses, then
--   drop function public.is_pre_audit_member();
--   drop function public.is_internal_audit_member();
-- Note: reverting re-locks the Internal Audit team out of the page.
