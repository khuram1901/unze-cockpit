-- Migration 192: Department cleanup — stop fake departments appearing
--
-- Khuram (24/07/2026): "our departments are getting bigger and bigger...
-- we need to stop this addition". Investigation found NOBODY was adding
-- departments — the pollution had three sources:
--
--   1. The department filter and the workload/breakdown RPCs fell back to
--      the task's `project` field when assigned_to_department was null, so
--      meeting titles ("Weekly Discussion and Updates", "Finance Review:
--      Cash Flow...") appeared as departments. Fixed in code + RPCs here.
--   2. 4 old tasks carry "Taxation" — a stray duplicate of "Tax". Merged.
--   3. "IT" has 2 members and 21 tasks but was never registered in
--      department_owners (the canonical list only Khuram edits). Added
--      here as a real department — strike that statement before running
--      if IT should NOT be a department.
--
-- Apply manually via Supabase SQL Editor.

begin;

-- 2. Merge stray "Taxation" into canonical "Tax"
UPDATE public.tasks
SET assigned_to_department = 'Tax'
WHERE assigned_to_department = 'Taxation';

-- 3. Register IT as a canonical department (it has members and tasks)
INSERT INTO public.department_owners (department_name)
SELECT 'IT'
WHERE NOT EXISTS (
  SELECT 1 FROM public.department_owners WHERE department_name = 'IT'
);

-- 1. RPCs: drop the `project` fallback — department means
--    assigned_to_department, full stop.

create or replace function public.get_tasks_department_breakdown()
returns table (
  department text,
  open_count bigint,
  overdue_count bigint
) as $$
  select
    coalesce(assigned_to_department, 'Unassigned') as department,
    count(*) filter (where status not in ('Completed', 'Cancelled')) as open_count,
    count(*) filter (where status not in ('Completed', 'Cancelled') and due_date < current_date) as overdue_count
  from public.tasks
  where
    can_access_all_tasks()
    or assigned_to_email = (select auth.email())
    or assigned_by = (select m.name from public.members m where m.email = (select auth.email()))
  group by coalesce(assigned_to_department, 'Unassigned')
  order by overdue_count desc, open_count desc;
$$ language sql stable security definer set search_path = public;

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
    coalesce(assigned_to_department, 'Unassigned') as department,
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
    (coalesce(assigned_to_department, 'Unassigned')),
    (coalesce(assigned_to_department, 'Unassigned'), coalesce(assigned_to, 'Unassigned'), assigned_to_email)
  )
  order by
    2,
    1 desc,
    7 desc, 5 desc;
$$ language sql stable security definer set search_path = public;

commit;
