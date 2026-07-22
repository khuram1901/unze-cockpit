-- Migration 190: Pre-audit team company links + responsible-scoped RPC
--
-- PROBLEM: The "Pre-audit team" had no rows in audit_team_companies, so
-- audit_my_tasks() returned zero projects for Attia, Abdul Rehman, and Fraz.
--
-- NAIVE FIX (wrong): linking them to all 4 companies would show all 63
-- processes — far too many. They are each responsible for exactly one process
-- ("Final settlement audit") in specific companies.
--
-- CORRECT FIX (two parts):
--
-- 1. Link the Pre-audit team to all four audit companies so the RPC can
--    find their processes through the company join.
--
-- 2. Update audit_my_tasks() so that for Pre-audit teams the result is
--    further filtered to only processes where the calling member is listed
--    as responsible for at least one stage task. Post-audit teams are
--    unaffected — they continue to see all processes for their company.
--
-- Current responsible assignments for pre-audit members:
--   Abdul Rehman → Final settlement audit (HD, BRNH) — stages 3 & 4
--   Attia        → Final settlement audit (IFPL)     — stages 3 & 4
--   Fraz         → Final settlement audit (UTPL)     — stages 3 & 4

-- Step 1: link Pre-audit team to all four audit companies
insert into audit_team_companies (team_id, company_id)
select
  (select id from audit_teams where name = 'Pre-audit team') as team_id,
  c.id
from companies c
where c.short_code in ('UTPL', 'IFPL', 'HD', 'BRNH')
on conflict do nothing;

-- Step 2: update the RPC to scope by responsible for pre-audit teams
create or replace function audit_my_tasks()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_email       text := auth.email();
  v_team_id     uuid;
  v_team_name   text;
  v_member_name text;
begin
  if not (is_admin_or_exec() or get_user_department() = 'Audit') then
    return jsonb_build_object('error', 'not_authorised');
  end if;

  -- Find the calling member's team and their normalised display name
  select atm.team_id,
         at.name,
         regexp_replace(m.name, '\s+', ' ', 'g')   -- collapse double spaces
    into v_team_id, v_team_name, v_member_name
    from members m
    join audit_team_members atm on atm.member_id = m.id
    join audit_teams        at  on at.id = atm.team_id
   where lower(m.email) = lower(v_email)
   limit 1;

  -- No team assignment (e.g., manager) → empty result
  if v_team_id is null then
    return jsonb_build_object('projects', '[]'::jsonb, 'team_name', null::text);
  end if;

  return (
    select jsonb_build_object(
      'team_name', v_team_name,
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
                from audit_stage_tasks t
               where t.process_id = p.id
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
             where (
               -- Post-audit teams: show all processes for their companies (unchanged)
               v_team_name not like 'Pre-audit%'
               or
               -- Pre-audit teams: only show processes where this member is
               -- responsible for at least one stage task.
               -- Match by normalising member name to collapse double spaces,
               -- then check if the responsible field appears within it
               -- (e.g., "Fraz" within "Muhammad Fraz", "Abdul Rehman" within
               -- "Abdul Rehman", "Attia" within "Attia Iftikhar").
               exists (
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
             )
          ) sub
      ), '[]'::jsonb)
    )
  );
end $$;

grant execute on function audit_my_tasks() to authenticated;
