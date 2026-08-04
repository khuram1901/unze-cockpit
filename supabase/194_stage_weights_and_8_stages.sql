-- Migration 194: Stage-weight completion %, 8 stages, remove day budgets
--
-- Audit manager (Shahid) requested:
-- 1. Remove day/timeline budgets from all stage tasks — they conflict with the
--    project-level target date and distort the dashboard.
-- 2. Replace day-ratio completion % with fixed stage weights (sum to 100%).
-- 3. Restructure from 7 to 8 stages: rename stage 4, add new stage 5
--    "Draft Internal audit report", shift stages 5-7 → 6-8.
--
-- Stage weights:
--   1 Audit Planning                          5%
--   2 Data Collection                        10%
--   3 Data Verification                      40%
--   4 Composition of audit findings          20%  (was "Draft Audit Findings")
--   5 Draft Internal audit report            10%  (NEW — auto-assigned from stage 4)
--   6 Review audit report                     9%  (was stage 5)
--   7 Communication of audit report           5%  (was stage 6)
--   8 Submission to senior management         1%  (was stage 7)
--
-- The new stage 5 is seeded with the same responsible as each process's stage 4.
-- Stage 4 has exactly 1 task per process, so this is a clean 1:1 mapping.

-- ── Step 1: Clear all day budgets ────────────────────────────────────────────
update audit_stage_tasks set total_days = null, days = null, days_2 = null;

-- ── Step 2: Renumber and rename existing stages (descending to avoid conflicts) ─
-- 7 → 8
update audit_stage_tasks
set stage_no = 8, stage_label = 'Submission to senior management'
where stage_no = 7;

-- 6 → 7
update audit_stage_tasks
set stage_no = 7, stage_label = 'Communication of audit report to process owner'
where stage_no = 6;

-- 5 → 6
update audit_stage_tasks
set stage_no = 6, stage_label = 'Review audit report'
where stage_no = 5;

-- Rename stage 4 (number unchanged)
update audit_stage_tasks
set stage_label = 'Composition of audit findings'
where stage_no = 4;

-- ── Step 3: Insert new stage 5 for each process ──────────────────────────────
-- Responsible is copied from the process's existing stage 4 task.
-- Stage 4 has exactly 1 row per process, so this inserts exactly 63 rows.
insert into audit_stage_tasks (process_id, stage_no, stage_label, responsible, sort_order, status)
select distinct on (t4.process_id)
  t4.process_id,
  5,
  'Draft Internal audit report',
  t4.responsible,
  1,
  'Not Started'
from audit_stage_tasks t4
where t4.stage_no = 4
order by t4.process_id;

-- ── Step 4: Updated audit_team_overview() — weight-based completion % ────────
create or replace function audit_team_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
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

  if not (v_is_mgr or get_user_department() = 'Audit' or is_admin_or_exec()) then
    return jsonb_build_object('error', 'not_authorised');
  end if;

  with vis_teams as (
    select t.* from audit_teams t
    where v_is_mgr or t.id = v_team
  ),
  -- Stage weights lookup (inline — no extra table needed)
  stage_w(sn, w) as (
    values (1,5),(2,10),(3,40),(4,20),(5,10),(6,9),(7,5),(8,1)
  ),
  task_calc as (
    select tk.id, tk.process_id, tk.stage_no, tk.status,
           tk.sub_task, tk.stage_label, tk.responsible, tk.responsible_2,
           p.company_id, p.process_name,
           atc.team_id,
           -- idle: In Progress but no update for 5 days (timelines removed,
           -- so "over budget" detection is gone; only idle check remains)
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
      -- Weight-based completion: sum weights of fully-completed stages
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
      where m.department = 'Audit' and m.is_active and m.role <> 'Manager'
    ), '[]'::jsonb) else '[]'::jsonb end
  ) into result;

  return result;
end $$;
grant execute on function audit_team_overview() to authenticated;

-- ── Step 5: Updated audit_my_tasks() — weight-based completion % ─────────────
create or replace function audit_my_tasks()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_email       text := auth.email();
  v_team_id     uuid;
  v_team_name   text;
  v_member_name text;
  v_projects    jsonb;
begin
  if not (is_admin_or_exec() or get_user_department() = 'Audit') then
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

  -- Inline stage weights
  -- 1→5, 2→10, 3→40, 4→20, 5→10, 6→9, 7→5, 8→1

  -- ── Pre-audit path ──────────────────────────────────────────────────────────
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

  -- ── Post-audit path ─────────────────────────────────────────────────────────
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
end $$;
grant execute on function audit_my_tasks() to authenticated;
