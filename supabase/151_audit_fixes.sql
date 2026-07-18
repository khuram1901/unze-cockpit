-- 151_audit_fixes.sql
-- Shahid's Recommendations 2.docx (19/07/2026):
-- 1. Fix progress % showing 0% on projects with no day budgets (merged legacy projects)
--    — add stage-count fallback in audit_team_overview RPC when total_days = 0.
-- 2. Reassign "Final settlement audit" working stages to Pre-audit team members
--    (Fraz/UTPL, Attia/IFPL, Abdul Rehman/HD+BRNH) — Shahid stages unchanged.
-- 3. Delete "Cash payments audit" (UTPL) — not a standalone project; covered by
--    Accounts Payable verification in the annual plan.

-- === 1. Fix audit_team_overview: stage-count fallback when total_days = 0 ===
create or replace function audit_team_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_email text := auth.email();
  v_is_mgr boolean := is_audit_manager();
  v_team uuid;
  result jsonb;
begin
  select atm.team_id into v_team
    from audit_team_members atm join members m on m.id = atm.member_id
   where m.email = v_email limit 1;

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
           -- Completion %: day-weighted when budgets exist, stage-count fallback when not
           case
             when p.status = 'Completed' then 100
             when coalesce(a.total_days, 0) > 0
               then round(100.0 * coalesce(a.done_days, 0) / a.total_days)::int
             when coalesce(a.total_stages, 0) > 0
               then round(100.0 * coalesce(a.done_stages, 0) / a.total_stages)::int
             else 0
           end as completion_pct
    from audit_plan_processes p
    join audit_team_companies atc on atc.company_id = p.company_id
    left join lateral (
      select sum(coalesce(t.total_days, 0)) as total_days,
             sum(coalesce(t.total_days, 0)) filter (where t.status = 'Completed') as done_days,
             count(*)                                                               as total_stages,
             count(*) filter (where t.status = 'Completed')                        as done_stages,
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
    'viewer', jsonb_build_object('is_manager', v_is_mgr, 'team_id', v_team),
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

-- === 2. Reassign Final settlement audit working stages → Pre-audit team members ===
-- Shahid confirmed this is a pre-audit task (Recommendations 2.docx, 19/07/2026).
-- Stages owned by Shahid (1 = Audit Planning, 5-7 = Review/Communication/Submission)
-- are untouched; only the field-work stages (2, 3, 4) move to pre-audit members.
update audit_stage_tasks ast
set responsible = case c.short_code
      when 'UTPL' then 'Fraz'
      when 'IFPL' then 'Attia'
      else 'Abdul Rehman'   -- HD and BRNH
    end,
    updated_at = now()
from audit_plan_processes p
join companies c on c.id = p.company_id
where ast.process_id = p.id
  and p.process_name ilike '%Final%Settlement%'
  and ast.stage_no in (2, 3, 4)
  and ast.responsible in ('Amina', 'Junaid', 'Khizar');  -- only update the post-audit assignments

-- === 3. Delete Cash payments audit (UTPL) ===
-- Shahid: "not an independent task — part of Accounts Payable verification".
-- Cascade removes the audit_stage_tasks rows automatically.
delete from audit_plan_processes
where process_name ilike '%Cash payments audit%'
  and company_id = (select id from companies where short_code = 'UTPL');
