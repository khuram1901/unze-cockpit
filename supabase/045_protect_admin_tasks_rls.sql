-- Migration 045: Enforce protected-task rule at the database level
--
-- Migration 042 added assigned_by_email and noted "Tasks created by
-- Admin/CEO/PA are protected — assignees cannot edit or delete them" but
-- the tasks_update/tasks_delete RLS policies (030, 038) never actually
-- checked it — protection only existed client-side (permissions.ts
-- isTaskProtected / canEditTask / canDeleteTask). An assignee could call
-- the API directly and edit or delete a task issued by the CEO/Admin/PA.
--
-- Now that broader members are being granted can_create_tasks /
-- can_see_all_tasks via the Access Matrix, this needs to be a real
-- database rule, not just a UI nicety.
--
-- Bypass uses is_privileged() (Admin tier + Executive/PA role) rather than
-- can_access_all_tasks() (which follows the can_see_all_tasks override) so
-- that granting a regular member "see all tasks" never lets them edit or
-- delete a task issued by Admin/CEO/PA — matching canEditTask/canDeleteTask
-- in permissions.ts exactly, which only ever check isAdminTier(u) || isPA(u).

CREATE OR REPLACE FUNCTION is_protected_task_creator(creator_email text)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(lower(creator_email), '') IN (
    'khuram1901@gmail.com',   -- ADMIN_EMAIL
    'k.saleem@unzegroup.com', -- CEO_EMAIL
    'pa.ceo@unze.co.uk'       -- PA_EMAIL
  );
$$ LANGUAGE SQL IMMUTABLE;

DROP POLICY IF EXISTS "tasks_update" ON tasks;
CREATE POLICY "tasks_update" ON tasks FOR UPDATE USING (
  is_privileged()
  OR (
    (assigned_to_email = auth.email() OR assigned_by = (SELECT name FROM members WHERE email = auth.email()))
    AND NOT is_protected_task_creator(assigned_by_email)
  )
);

DROP POLICY IF EXISTS "tasks_delete" ON tasks;
CREATE POLICY "tasks_delete" ON tasks FOR DELETE
  USING (
    is_privileged()
    OR (
      assigned_to_email = auth.email()
      AND NOT is_protected_task_creator(assigned_by_email)
    )
  );
