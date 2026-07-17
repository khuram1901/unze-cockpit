-- 130: Rule-0 cleanup (15 Jul 2026 audit, Medium — converted properly per
-- Khuram's decision rather than left as a documented exception).
--
-- app/lib/department-config.ts declared each of the 6 department
-- dashboards' KPI tiles as small JS functions (countFn) that filtered/
-- summed rows already fetched into the browser. This RPC computes the
-- same numbers in Postgres instead, one department at a time (matched by
-- slug), so DepartmentDashboard.tsx and the CEO home page's department
-- health cards can both call it instead of re-deriving counts from raw
-- rows.
--
-- Bonus correctness fix folded in: app/home/page.tsx's per-department
-- health check filtered every department's table by company_id only —
-- for the admin/it/ops slugs (all backed by the "tasks" table), it never
-- filtered by assigned_to_department, so the Admin/IT/Ops health cards on
-- the CEO home page were all silently computed from the exact same
-- unfiltered set of UTPL tasks. This RPC takes p_department_name and
-- filters by it for those three slugs, matching what the department
-- dashboard page itself has always done — so Admin/IT/Ops will now show
-- genuinely different, correct numbers on the home page instead of
-- identical ones.
--
-- Apply manually via the Supabase SQL Editor, per project convention.

create or replace function get_department_kpi_counts(
  p_slug text,
  p_department_name text,
  p_company_id uuid,
  p_today date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if p_slug = 'audit' then
    select jsonb_build_object(
      'planned',        count(*) filter (where status = 'Planned'),
      'in_progress',    count(*) filter (where status = 'In Progress'),
      'completed',      count(*) filter (where status = 'Completed'),
      'overdue',        count(*) filter (where status not in ('Completed', 'Cancelled') and target_date is not null and target_date < p_today),
      'avg_completion', round(coalesce(avg(completion_pct) filter (where status <> 'Cancelled'), 0))
    )
    into result
    from audit_plan_items
    where company_id = p_company_id;

  elsif p_slug = 'hr' then
    select jsonb_build_object(
      'open',      count(*) filter (where status in ('Open', 'Interviewing')),
      'filled',    count(*) filter (where status = 'Filled'),
      'long_open', count(*) filter (where status in ('Open', 'Interviewing') and date_opened is not null and (p_today - date_opened) > 60),
      'total',     count(*)
    )
    into result
    from recruitment_positions
    where company_id = p_company_id;

  elsif p_slug = 'taxation' then
    select jsonb_build_object(
      'pending',       count(*) filter (where resolution_status = 'pending'),
      'hearing_soon',  count(*) filter (where resolution_status = 'pending' and hearing_deadline is not null and hearing_deadline >= p_today and hearing_deadline < p_today + 7),
      'high_exposure', count(*) filter (where resolution_status = 'pending' and financial_exposure > 500000),
      'resolved',      count(*) filter (where resolution_status <> 'pending')
    )
    into result
    from legal_notices
    where company_id = p_company_id;

  elsif p_slug in ('admin', 'it', 'ops') then
    select jsonb_build_object(
      'open',      count(*) filter (where status not in ('Completed', 'Cancelled')),
      'overdue',   count(*) filter (where status not in ('Completed', 'Cancelled') and due_date is not null and due_date < p_today),
      'completed', count(*) filter (where status = 'Completed'),
      'total',     count(*)
    )
    into result
    from tasks
    where assigned_to_department = p_department_name;

  else
    result := '{}'::jsonb;
  end if;

  return result;
end;
$$;

grant execute on function get_department_kpi_counts(text, text, uuid, date) to authenticated;
