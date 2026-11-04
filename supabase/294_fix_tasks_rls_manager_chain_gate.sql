-- Migration 294 (final): Restore tasks_select RLS to the original policy.
--
-- Context: migrations 294 and 294b attempted to gate is_in_manager_chain() and
-- is_manager_of_creator() for users with can_see_all_tasks=false. Both approaches
-- failed:
--   294:  used can_access_all_tasks() — too broad, would have broken all managers
--   294b: called perm_override() directly — not executable by authenticated role
--         inside an RLS policy, caused "permission denied" for all users on /tasks
--
-- The Kamran fix is fully handled client-side (TasksList.tsx migration in this same
-- commit: canSeeAll===false skips the myReportEmails clause). The RLS manager-chain
-- clauses are functionally unused for restricting tasks (all 24 managers with direct
-- reports have can_see_all_tasks=false and use the client-side clause instead).
--
-- Restoring the original policy removes the breakage.

DROP POLICY IF EXISTS tasks_select ON tasks;

CREATE POLICY tasks_select ON tasks
  FOR SELECT USING (
    can_access_all_tasks()
    OR assigned_to_email = (SELECT auth.email())
    OR assigned_by = (SELECT name FROM members WHERE email = (SELECT auth.email()))
    OR is_task_assignee(id)
    OR is_task_creator(id)
    OR is_in_manager_chain(assigned_to_email)
    OR is_manager_of_creator(assigned_by_email)
  );
