-- Migration 294: Gate manager-chain RLS clauses behind can_access_all_tasks()
-- Previously is_in_manager_chain() and is_manager_of_creator() ran unconditionally,
-- meaning Kamran (can_see_all_tasks=false, 12 direct reports) could see every task
-- assigned to or created by his reports even though his override says "own only".
-- Now both clauses are short-circuited by can_access_all_tasks() first.

DROP POLICY IF EXISTS tasks_select ON tasks;

CREATE POLICY tasks_select ON tasks
  FOR SELECT USING (
    can_access_all_tasks()
    OR assigned_to_email = (SELECT auth.email())
    OR assigned_by = (SELECT name FROM members WHERE email = (SELECT auth.email()))
    OR is_task_assignee(id)
    OR is_task_creator(id)
    -- Manager-chain visibility: only when the user hasn't been explicitly restricted
    -- to their own tasks (can_see_all_tasks = false override).
    OR (can_access_all_tasks() AND is_in_manager_chain(assigned_to_email))
    OR (can_access_all_tasks() AND is_manager_of_creator(assigned_by_email))
  );
