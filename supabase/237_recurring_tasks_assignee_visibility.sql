-- Migration 237: Recurring Task Assignee Visibility
-- Problem (E5): Employees assigned to a recurring task template cannot see that
-- template in the RecurringTasksPanel — the 072 migration restricted SELECT to
-- is_admin_or_exec() only. This is correct for the template MANAGER view, but an
-- assigned employee should be able to see the templates they are responsible for
-- (so they know it's a recurring commitment, not a one-off).
--
-- Fix: extend the SELECT policy to also allow the assigned employee
-- (assigned_to_email = auth.email()). Write policies remain admin/exec only.
-- Generated task INSTANCES in the tasks table are already visible via tasks_select.
--
-- Apply via Supabase SQL Editor. Idempotent (DROP IF EXISTS before CREATE).

begin;

drop policy if exists "recurring_read" on public.recurring_tasks;

create policy "recurring_read" on public.recurring_tasks
  for select
  using (
    is_admin_or_exec()
    or (assigned_to_email = (select auth.email()))
  );

-- Write policies unchanged: admin/exec only.
-- (recurring_write from migration 072 remains.)

commit;
