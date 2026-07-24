-- Migration 191: Workload scoreboard RPC
--
-- Khuram (24/07/2026): "we need to create filters where i can see which
-- tasks are outstanding by the teams, department, per person". The Team
-- view becomes a Workload scoreboard: one row per department, expandable
-- to people, with Open / Overdue / Stuck / Waiting / Submitted counts and
-- click-through to the actual tasks.
--
-- One round-trip returns BOTH levels via GROUPING SETS: department
-- rollup rows (is_department = true) and per-person rows within each
-- department — no JS aggregation anywhere, per house rule 0.
--
-- Same hand-written visibility rule as the other SECURITY DEFINER task
-- RPCs (see 101): privileged callers see everything, others only their
-- own/assigned-by rows. The UI additionally only shows the Team pill to
-- privileged users, but the function must not rely on that.
--
-- Apply manually via Supabase SQL Editor.

begin;

create or replace function public.get_task_workload()
returns table (
  is_department boolean,
  department text,
  person_name text,
  person_email text,
  open_count bigint,
  overdue_count bigint,
  stuck_count bigint,
  waiting_count bigint,
  submitted_count bigint,
  oldest_overdue_days integer,
  on_time_rate numeric
) as $$
  select
    grouping(coalesce(assigned_to, 'Unassigned'), assigned_to_email) > 0 as is_department,
    coalesce(assigned_to_department, project, 'Unassigned') as department,
    case when grouping(coalesce(assigned_to, 'Unassigned'), assigned_to_email) > 0
         then null else coalesce(assigned_to, 'Unassigned') end as person_name,
    case when grouping(coalesce(assigned_to, 'Unassigned'), assigned_to_email) > 0
         then null else assigned_to_email end as person_email,
    count(*) filter (where status not in ('Completed', 'Cancelled')) as open_count,
    count(*) filter (where status not in ('Completed', 'Cancelled') and due_date < current_date) as overdue_count,
    count(*) filter (where status = 'Stuck') as stuck_count,
    count(*) filter (where status = 'Waiting Reply') as waiting_count,
    count(*) filter (where status = 'Submitted') as submitted_count,
    max(current_date - due_date) filter (
      where status not in ('Completed', 'Cancelled') and due_date < current_date
    ) as oldest_overdue_days,
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
  group by grouping sets (
    (coalesce(assigned_to_department, project, 'Unassigned')),
    (coalesce(assigned_to_department, project, 'Unassigned'), coalesce(assigned_to, 'Unassigned'), assigned_to_email)
  )
  -- Departments with the most overdue first; people within a department
  -- likewise. Rollup row (is_department) always sorts before its people.
  order by
    2,                     -- department name (stable grouping for the UI)
    1 desc,                -- department rollup row first within its group
    7 desc, 5 desc;        -- then people: overdue desc, open desc
$$ language sql stable security definer set search_path = public;

commit;
