-- Migration 101: Task summary RPCs — KPI row, department breakdown, Team view
--
-- House rule: aggregation happens in Postgres, never in a JS loop. These
-- three read-only functions replace client-side .filter()/.reduce() work
-- for the numbers the Tasks page redesign needs: the KPI/attention-banner
-- row, the department breakdown, and the Team performance view.
--
-- Each function repeats the exact same visibility rule as the tasks_select
-- RLS policy (can_access_all_tasks() OR assigned_to_email = me OR
-- assigned_by = my name) directly in its WHERE clause. This is necessary
-- because these are SECURITY DEFINER functions (required so a Manager can
-- get an aggregate count without needing table-level GRANTs) — a
-- SECURITY DEFINER function does not automatically re-apply the caller's
-- RLS, so the same restriction has to be written out by hand here to
-- avoid accidentally handing out company-wide numbers to someone who
-- shouldn't see them.
--
-- The Team view's on-time rate is now computable for the first time,
-- because migration 098 added completed_at and original_due_date — a
-- task is "on time" if it was completed on or before its original due
-- date. Before those columns existed this was honestly "not trackable
-- yet"; it now is.
--
-- Apply via Supabase SQL Editor, after 098/099/100.

begin;

-- p_company_id / p_group_only let the Tasks page's Company dropdown filter
-- these numbers too, so the KPI row always matches what's on screen below
-- it instead of always showing the company-wide totals regardless of filter.
--   p_company_id = null, p_group_only = false  → no company filter (default)
--   p_company_id = <uuid>                       → only that company
--   p_group_only = true                         → only company_id IS NULL ("Group / needs review")
create or replace function public.get_tasks_kpi_summary(
  p_company_id uuid default null,
  p_group_only boolean default false
)
returns table (
  open_count bigint,
  overdue_count bigint,
  due_today_count bigint,
  waiting_reply_count bigint,
  stuck_count bigint,
  completed_count bigint
) as $$
  select
    count(*) filter (where status not in ('Completed', 'Cancelled')) as open_count,
    count(*) filter (where status not in ('Completed', 'Cancelled') and due_date < current_date) as overdue_count,
    count(*) filter (where status not in ('Completed', 'Cancelled') and due_date = current_date) as due_today_count,
    count(*) filter (where status = 'Waiting Reply') as waiting_reply_count,
    count(*) filter (where status = 'Stuck') as stuck_count,
    count(*) filter (where status = 'Completed') as completed_count
  from public.tasks
  where
    (
      can_access_all_tasks()
      or assigned_to_email = (select auth.email())
      or assigned_by = (select m.name from public.members m where m.email = (select auth.email()))
    )
    and (
      (p_group_only and company_id is null)
      or (not p_group_only and p_company_id is not null and company_id = p_company_id)
      or (not p_group_only and p_company_id is null)
    );
$$ language sql stable security definer set search_path = public;


create or replace function public.get_tasks_department_breakdown()
returns table (
  department text,
  open_count bigint,
  overdue_count bigint
) as $$
  select
    coalesce(assigned_to_department, project, 'Unassigned') as department,
    count(*) filter (where status not in ('Completed', 'Cancelled')) as open_count,
    count(*) filter (where status not in ('Completed', 'Cancelled') and due_date < current_date) as overdue_count
  from public.tasks
  where
    can_access_all_tasks()
    or assigned_to_email = (select auth.email())
    or assigned_by = (select m.name from public.members m where m.email = (select auth.email()))
  group by coalesce(assigned_to_department, project, 'Unassigned')
  order by overdue_count desc, open_count desc;
$$ language sql stable security definer set search_path = public;


create or replace function public.get_tasks_team_stats()
returns table (
  person_name text,
  person_email text,
  open_count bigint,
  overdue_count bigint,
  completed_count bigint,
  on_time_rate numeric
) as $$
  select
    coalesce(assigned_to, 'Unassigned') as person_name,
    assigned_to_email as person_email,
    count(*) filter (where status not in ('Completed', 'Cancelled')) as open_count,
    count(*) filter (where status not in ('Completed', 'Cancelled') and due_date < current_date) as overdue_count,
    count(*) filter (where status = 'Completed') as completed_count,
    round(
      100.0 * count(*) filter (
        where status = 'Completed'
          and completed_at is not null
          and completed_at::date <= coalesce(original_due_date, due_date)
      )
      / nullif(count(*) filter (where status = 'Completed' and completed_at is not null), 0),
      0
    ) as on_time_rate
  from public.tasks
  where
    can_access_all_tasks()
    or assigned_to_email = (select auth.email())
    or assigned_by = (select m.name from public.members m where m.email = (select auth.email()))
  group by coalesce(assigned_to, 'Unassigned'), assigned_to_email
  order by overdue_count desc, open_count desc;
$$ language sql stable security definer set search_path = public;

commit;
