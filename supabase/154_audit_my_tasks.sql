-- 154_audit_my_tasks.sql
-- Khuram (21/07/2026): audit project stage tasks should surface on the Tasks
-- page so audit members can update progress from one place rather than having
-- to navigate to the Audit department page separately.
--
-- audit_my_tasks() returns the calling member's audit projects and their stage
-- tasks, scoped to the member's team companies. The completion_pct per project
-- is calculated the same way audit_team_overview() does it (sum of done days /
-- total days), so the progress bar on the Tasks page stays in sync with the
-- Audit page automatically.
--
-- Managers (Shahid) have no team_id in audit_team_members, so they get an
-- empty project list — they review progress on the Audit page where they have
-- the full manager view.
--
-- Stage task status updates are done directly by the client via
-- supabase.from("audit_stage_tasks").update(...) — no separate route needed
-- since the existing RLS (dept_access) already allows Audit members to write.

create or replace function audit_my_tasks()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_email   text := auth.email();
  v_team_id uuid;
begin
  if not (is_admin_or_exec() or get_user_department() = 'Audit') then
    return jsonb_build_object('error', 'not_authorised');
  end if;

  -- Find the calling member's team assignment
  select atm.team_id
    into v_team_id
    from members m
    join audit_team_members atm on atm.member_id = m.id
   where m.email = v_email
   limit 1;

  -- No team assignment (e.g., manager) → no project list
  if v_team_id is null then
    return jsonb_build_object('projects', '[]'::jsonb, 'team_name', null::text);
  end if;

  return (
    select jsonb_build_object(
      'team_name', (select name from audit_teams where id = v_team_id),
      'projects', coalesce((
        select jsonb_agg(proj order by proj->>'company_id', (proj->>'s_no')::int)
          from (
            select jsonb_build_object(
              'id',             p.id,
              's_no',           p.s_no,
              'process_name',   p.process_name,
              'company_id',     p.company_id,
              'period_label',   p.period_label,
              'status',         p.status,
              'status_note',    p.status_note,
              'target_date',    p.target_date,
              'total_days',     coalesce(td.total, 0),
              'done_days',      coalesce(dd.done, 0),
              'completion_pct', case
                when p.status = 'Completed'      then 100
                when coalesce(td.total, 0) > 0   then round(100.0 * coalesce(dd.done, 0) / td.total)::int
                else 0
              end,
              'stages', coalesce((
                select jsonb_agg(
                  jsonb_build_object(
                    'id',           t.id,
                    'stage_no',     t.stage_no,
                    'stage_label',  t.stage_label,
                    'sub_task',     t.sub_task,
                    'responsible',  t.responsible,
                    'responsible_2',t.responsible_2,
                    'total_days',   t.total_days,
                    'status',       t.status,
                    'started_at',   t.started_at,
                    'completed_at', t.completed_at,
                    'sort_order',   t.sort_order
                  ) order by t.stage_no, t.sort_order
                )
                from audit_stage_tasks t
               where t.process_id = p.id
              ), '[]'::jsonb)
            ) as proj
              from audit_plan_processes p
              join audit_team_companies atc on atc.company_id = p.company_id and atc.team_id = v_team_id
              left join lateral (
                select sum(coalesce(t.total_days, 0)) as total
                  from audit_stage_tasks t where t.process_id = p.id
              ) td on true
              left join lateral (
                select sum(coalesce(t.total_days, 0)) filter (where t.status = 'Completed') as done
                  from audit_stage_tasks t where t.process_id = p.id
              ) dd on true
          ) sub
      ), '[]'::jsonb)
    )
  );
end $$;
grant execute on function audit_my_tasks() to authenticated;
