-- Migration 102: Monthly + Quarterly chart RPCs
--
-- House rule 0: no aggregation in JS. TasksList.tsx was building its
-- Monthly ("Created vs Completed — Last 6 Months") and Quarterly
-- ("Overdue / Active / Completed by quarter") bar charts by looping over
-- every loaded task client-side (monthMap / qMap with a for-loop). These
-- two functions replace that with a single round trip each, same as the
-- KPI/department/team RPCs in migration 101.
--
-- Note: the Department and Weekly views are deliberately NOT touched by
-- this migration — they render full per-task rows grouped in memory, not
-- just counts, so they still need the full task list either way. Only the
-- two chart aggregations move to the database.
--
-- Same visibility rule as migration 101's RPCs (can_access_all_tasks() OR
-- assigned_to_email = me OR assigned_by = my name), and the same
-- p_company_id/p_group_only params as get_tasks_kpi_summary so the charts
-- respect the Company dropdown.
--
-- Apply via Supabase SQL Editor, after 098/099/100/101.

begin;

-- Last 6 calendar months (by created_at), created vs completed counts.
create or replace function public.get_tasks_monthly_chart(
  p_company_id uuid default null,
  p_group_only boolean default false
)
returns table (
  month text,
  label text,
  created bigint,
  completed bigint
) as $$
  with months as (
    select to_char(d, 'YYYY-MM') as month
    from generate_series(
      date_trunc('month', current_date) - interval '5 months',
      date_trunc('month', current_date),
      interval '1 month'
    ) as d
  ),
  visible_tasks as (
    select *
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
      )
  )
  select
    months.month,
    to_char(to_date(months.month, 'YYYY-MM'), 'Mon YYYY') as label,
    count(*) filter (where to_char(t.created_at, 'YYYY-MM') = months.month) as created,
    count(*) filter (where to_char(t.created_at, 'YYYY-MM') = months.month and t.status = 'Completed') as completed
  from months
  left join visible_tasks t on to_char(t.created_at, 'YYYY-MM') = months.month
  group by months.month
  order by months.month;
$$ language sql stable security definer set search_path = public;


-- Quarter (by due_date, falling back to created_at) split into
-- overdue / active / completed counts.
create or replace function public.get_tasks_quarterly_chart(
  p_company_id uuid default null,
  p_group_only boolean default false
)
returns table (
  quarter text,
  overdue bigint,
  active bigint,
  completed bigint
) as $$
  with visible_tasks as (
    select *,
      coalesce(due_date, created_at::date, current_date) as effective_date
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
      )
  )
  select
    'Q' || to_char(effective_date, 'Q') || ' ' || to_char(effective_date, 'YYYY') as quarter,
    count(*) filter (where status not in ('Completed', 'Cancelled') and due_date < current_date) as overdue,
    count(*) filter (where status not in ('Completed', 'Cancelled') and (due_date is null or due_date >= current_date)) as active,
    count(*) filter (where status = 'Completed') as completed
  from visible_tasks
  group by to_char(effective_date, 'YYYY'), to_char(effective_date, 'Q')
  order by min(effective_date);
$$ language sql stable security definer set search_path = public;

commit;
