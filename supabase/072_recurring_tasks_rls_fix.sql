-- 072_recurring_tasks_rls_fix.sql
-- Fix: recurring_tasks RLS was using is_admin_or_exec() which was redefined
-- in 027_role_model.sql to be Admin-only (not Executive).
-- PA (Executive role) needs INSERT/ALL access — switch to is_privileged().
-- Apply manually in Supabase SQL Editor.

DROP POLICY IF EXISTS "recurring_read"  ON recurring_tasks;
DROP POLICY IF EXISTS "recurring_write" ON recurring_tasks;

CREATE POLICY "recurring_read"  ON recurring_tasks
  FOR SELECT TO authenticated
  USING (is_privileged());

CREATE POLICY "recurring_write" ON recurring_tasks
  FOR ALL TO authenticated
  USING (is_privileged())
  WITH CHECK (is_privileged());
