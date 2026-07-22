-- Migration 192: Fix audit alert banner duplication caused by migration 190
--
-- PROBLEM: Migration 190 added the Pre-audit team to audit_team_companies for
-- all 4 companies (UTPL, IFPL, HD, BRNH). The audit_team_overview() RPC joins
-- processes through audit_team_companies, so every process now appears under
-- BOTH its post-audit team AND the pre-audit team. Stuck alerts are duplicated
-- — one copy says "Post-audit — X", the other says "Pre-audit team" — which is
-- the inconsistency Khuram and Shahid are seeing.
--
-- FIX (two parts):
--
-- 1. Remove the Pre-audit team from audit_team_companies completely.
--    The overview RPC then has no duplicates.
--
-- 2. Update audit_my_tasks() so that pre-audit members don't need the
--    company join at all. Instead, they get all processes where they are
--    listed as responsible for at least one stage task — queried directly
--    from audit_stage_tasks. Post-audit members are unchanged.

-- ── Part 1: Remove pre-audit team from audit_team_companies ──────────────────
delete from audit_team_companies
where team_id = (select id from audit_teams where name = 'Pre-audit team');

-- ── Part 2: Updated audit_my_tasks() ─────────────────────────────────────────
-- Two code paths:
--   Pre-audit team  → query by responsible field (no company join required)
--   Post-audit teams → company join as before (unchanged behaviour)
create or replace function audit_my_tasks()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_email       text := auth.email();
  v_team_id     uuid;
  v_team_name   text;
  v_member_name text;  -- normalised (double spaces collapsed)

  -- Reusable fragment builders
  v_projects    jsonb;
begin
  if not (is_admin_or_exec() or get_user_department() = 'Audit') then
    return jsonb_build_object('error', 'not_authorised');
  end if;

  -- Resolve team and normalised name in one shot
  select atm.team_id,
         at.name,
         regexp_replace(m.name, '\s+', ' ', 'g')
    into v_team_id, v_team_name, v_member_name
    from members m
    join audit_team_members atm on atm.member_id = m.id
    join audit_teams        at  on at.id = atm.team_id
   where lower(m.email) = lower(v_email)
   limit 1;

  -- No team assignment (e.g., manager) → empty
  if v_team_id is null then
    return jsonb_build_object('projects', '[]'::jsonb, 'team_name', null::text);
  end if;

  -- ── Pre-audit path ──────────────────────────────────────────────────────────
  -- Skip the company join entirely. Find processes where this member is
  -- responsible for at least one stage task. This keeps audit_team_companies
  -- clean (pre-audit team has no rows there) and avoids duplication in the
  -- audit_team_overview() stuck strip.
  if v_team_name like 'Pre-audit%' then
    select coalesce(jsonb_agg(proj order by proj->>'company_id', (proj->>'s_no')::int), '[]'::jsonb)
      into v_projects
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
            when p.status = 'Completed'    then 100
            when coalesce(td.total, 0) > 0 then round(100.0 * coalesce(dd.done, 0) / td.total)::int
            else 0
          end,
          'stages', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id',            t.id,
                'stage_no',      t.stage_no,
                'stage_label',   t.stage_label,
                'sub_task',      t.sub_task,
                'responsible',   t.responsible,
                'responsible_2', t.responsible_2,
                'total_days',    t.total_days,
                'status',        t.status,
                'started_at',    t.started_at,
                'completed_at',  t.completed_at,
                'sort_order',    t.sort_order
              ) order by t.stage_no, t.sort_order
            )
            from audit_stage_tasks t where t.process_id = p.id
          ), '[]'::jsonb)
        ) as proj
          from audit_plan_processes p
          left join lateral (
            select sum(coalesce(t.total_days, 0)) as total
              from audit_stage_tasks t where t.process_id = p.id
          ) td on true
          left join lateral (
            select sum(coalesce(t.total_days, 0)) filter (where t.status = 'Completed') as done
              from audit_stage_tasks t where t.process_id = p.id
          ) dd on true
         -- Only include processes where this member is responsible for ≥1 task
         where exists (
           select 1
             from audit_stage_tasks t2
            where t2.process_id = p.id
              and (
                v_member_name ilike '%' || t2.responsible || '%'
                or (
                  t2.responsible_2 is not null
                  and v_member_name ilike '%' || t2.responsible_2 || '%'
                )
              )
         )
      ) sub;

    return jsonb_build_object('team_name', v_team_name, 'projects', v_projects);
  end if;

  -- ── Post-audit path (unchanged) ─────────────────────────────────────────────
  -- Scope by the team's company assignments in audit_team_companies.
  select coalesce(jsonb_agg(proj order by proj->>'company_id', (proj->>'s_no')::int), '[]'::jsonb)
    into v_projects
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
          when p.status = 'Completed'    then 100
          when coalesce(td.total, 0) > 0 then round(100.0 * coalesce(dd.done, 0) / td.total)::int
          else 0
        end,
        'stages', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id',            t.id,
              'stage_no',      t.stage_no,
              'stage_label',   t.stage_label,
              'sub_task',      t.sub_task,
              'responsible',   t.responsible,
              'responsible_2', t.responsible_2,
              'total_days',    t.total_days,
              'status',        t.status,
              'started_at',    t.started_at,
              'completed_at',  t.completed_at,
              'sort_order',    t.sort_order
            ) order by t.stage_no, t.sort_order
          )
          from audit_stage_tasks t where t.process_id = p.id
        ), '[]'::jsonb)
      ) as proj
        from audit_plan_processes p
        join audit_team_companies atc
          on atc.company_id = p.company_id
         and atc.team_id    = v_team_id
        left join lateral (
          select sum(coalesce(t.total_days, 0)) as total
            from audit_stage_tasks t where t.process_id = p.id
        ) td on true
        left join lateral (
          select sum(coalesce(t.total_days, 0)) filter (where t.status = 'Completed') as done
            from audit_stage_tasks t where t.process_id = p.id
        ) dd on true
    ) sub;

  return jsonb_build_object('team_name', v_team_name, 'projects', v_projects);
end $$;

grant execute on function audit_my_tasks() to authenticated;
