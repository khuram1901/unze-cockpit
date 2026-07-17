-- 142_task_visibility_manager_hierarchy.sql
--
-- Khuram (17/07/2026): "no one can see anyone else's tasks unless they are
-- the manager and that person reports to them."
--
-- Today (tasks_select RLS policy, live definition confirmed via
-- pg_get_expr before writing this):
--   can_access_all_tasks() OR assigned_to_email = me OR assigned_by = my name
--   OR is_task_assignee(id)
-- can_access_all_tasks() is unchanged by Khuram's call (Admin/CEO/Executive,
-- or an explicit can_see_all_tasks override, keep seeing every task
-- company-wide). Everyone else currently only sees tasks they're the
-- assignee/creator/co-assignee on -- a manager gets no general visibility
-- into their direct reports' tasks (they only see a report's task once it's
-- Submitted and routed to them, via migration 113).
--
-- This adds exactly one more OR clause: if the task's assignee's manager_id
-- points back to the current user, they can see it -- a real "your
-- manager can see your tasks" rule, keyed off the manager_id column added
-- in 109_org_structure.sql (now populated for every member).

create or replace function public.is_manager_of_assignee(p_assignee_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from members target
    join members me on me.id = target.manager_id
    where target.email = p_assignee_email
      and me.email = (select auth.email())
  );
$$;

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
for select
using (
  can_access_all_tasks()
  or assigned_to_email = (select auth.email())
  or assigned_by = (select name from members where email = (select auth.email()))
  or is_task_assignee(id)
  or is_manager_of_assignee(assigned_to_email)
);
