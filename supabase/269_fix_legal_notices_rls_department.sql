-- Migration 269: Fix legal_notices RLS — department renamed to 'Finance & Tax'
--
-- The dept_access policy was created when 'Tax' and 'Finance' were separate
-- departments. They were later merged into 'Finance & Tax' but the RLS was
-- never updated. get_user_department() returns 'Finance & Tax' for all three
-- affected members (taxation@, taxation1@, moazzam@), which never matched
-- the old 'Tax' or 'Finance' literals — so every Finance & Tax user saw an
-- empty legal_notices table despite having the correct member_permissions row.
--
-- Apply via Supabase SQL Editor.

DROP POLICY IF EXISTS dept_access ON legal_notices;

CREATE POLICY dept_access ON legal_notices
  FOR ALL
  TO public
  USING (
    is_admin_or_exec()
    OR get_user_department() = 'Finance & Tax'
  )
  WITH CHECK (
    is_admin_or_exec()
    OR get_user_department() = 'Finance & Tax'
  );
