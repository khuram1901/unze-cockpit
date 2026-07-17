-- Migration 038: RLS hardening + task DELETE + production UPDATE/DELETE
-- Fixes items 8, 9, 10, 11, 13, 14, 17 from upgrade roadmap

-- ═══ ITEM 8: pending_minutes — restrict to Admin/Executive ═══
-- Currently fully open. Only admins review meeting transcripts.
DROP POLICY IF EXISTS "pending_minutes_all" ON pending_minutes;
CREATE POLICY "pending_minutes_admin"
  ON pending_minutes FOR ALL
  USING (is_admin_or_exec())
  WITH CHECK (is_admin_or_exec());

-- Service role needs access for cron inbox check
CREATE POLICY "pending_minutes_service"
  ON pending_minutes FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- ═══ ITEM 9: holdings/price_history — restrict to CEO/Admin ═══
-- Investment data should only be visible to CEO and Admin (matches canViewInvestments)

-- Holdings: drop old open policies, create restricted ones
DROP POLICY IF EXISTS "Authenticated users can read holdings" ON holdings;
DROP POLICY IF EXISTS "Authenticated users can insert holdings" ON holdings;
DROP POLICY IF EXISTS "Authenticated users can update holdings" ON holdings;
DROP POLICY IF EXISTS "Authenticated users can delete holdings" ON holdings;

CREATE POLICY "holdings_admin_read"
  ON holdings FOR SELECT
  TO authenticated
  USING (
    auth.email() IN ('khuram1901@gmail.com', 'k.saleem@unzegroup.com')
    OR get_user_role() = 'Admin'
  );

CREATE POLICY "holdings_admin_write"
  ON holdings FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.email() IN ('khuram1901@gmail.com', 'k.saleem@unzegroup.com')
    OR get_user_role() = 'Admin'
  );

CREATE POLICY "holdings_admin_update"
  ON holdings FOR UPDATE
  TO authenticated
  USING (
    auth.email() IN ('khuram1901@gmail.com', 'k.saleem@unzegroup.com')
    OR get_user_role() = 'Admin'
  );

CREATE POLICY "holdings_admin_delete"
  ON holdings FOR DELETE
  TO authenticated
  USING (
    auth.email() IN ('khuram1901@gmail.com', 'k.saleem@unzegroup.com')
    OR get_user_role() = 'Admin'
  );

-- Price history: drop old open policies, create restricted ones
DROP POLICY IF EXISTS "Authenticated users can read price_history" ON price_history;
DROP POLICY IF EXISTS "Authenticated users can insert price_history" ON price_history;
DROP POLICY IF EXISTS "Authenticated users can update price_history" ON price_history;

CREATE POLICY "price_history_admin_read"
  ON price_history FOR SELECT
  TO authenticated
  USING (
    auth.email() IN ('khuram1901@gmail.com', 'k.saleem@unzegroup.com')
    OR get_user_role() = 'Admin'
  );

CREATE POLICY "price_history_admin_write"
  ON price_history FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.email() IN ('khuram1901@gmail.com', 'k.saleem@unzegroup.com')
    OR get_user_role() = 'Admin'
  );

CREATE POLICY "price_history_admin_update"
  ON price_history FOR UPDATE
  TO authenticated
  USING (
    auth.email() IN ('khuram1901@gmail.com', 'k.saleem@unzegroup.com')
    OR get_user_role() = 'Admin'
  );


-- ═══ ITEM 10: push_subscriptions — restrict to own email ═══
-- Users should only see/manage their own push subscriptions
DROP POLICY IF EXISTS "push_sub_all" ON push_subscriptions;

CREATE POLICY "push_sub_own_select"
  ON push_subscriptions FOR SELECT
  TO authenticated
  USING (user_email = auth.email());

CREATE POLICY "push_sub_own_insert"
  ON push_subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (user_email = auth.email());

CREATE POLICY "push_sub_own_delete"
  ON push_subscriptions FOR DELETE
  TO authenticated
  USING (user_email = auth.email());

-- Service role full access for push notification cron
CREATE POLICY "push_sub_service"
  ON push_subscriptions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- ═══ ITEM 11: UPDATE/DELETE on production/dispatch/breakage entries ═══
-- Currently only SELECT + INSERT exist. Corrections silently fail.
-- Allow Admin/Executive to update/delete; Ops dept can update their entries.

CREATE POLICY "update_entries" ON production_entries FOR UPDATE
  USING (is_admin_or_exec() OR get_user_department() = 'Unze Trading Ops');

CREATE POLICY "delete_entries" ON production_entries FOR DELETE
  USING (is_admin_or_exec());

CREATE POLICY "update_entries" ON dispatch_entries FOR UPDATE
  USING (is_admin_or_exec() OR get_user_department() = 'Unze Trading Ops');

CREATE POLICY "delete_entries" ON dispatch_entries FOR DELETE
  USING (is_admin_or_exec());

CREATE POLICY "update_entries" ON breakage_entries FOR UPDATE
  USING (is_admin_or_exec() OR get_user_department() = 'Unze Trading Ops');

CREATE POLICY "delete_entries" ON breakage_entries FOR DELETE
  USING (is_admin_or_exec());


-- ═══ ITEM 13: DELETE policy on tasks table ═══
-- Task deletion silently fails because there's no DELETE policy
DROP POLICY IF EXISTS "tasks_delete" ON tasks;
CREATE POLICY "tasks_delete" ON tasks FOR DELETE
  USING (
    is_admin_or_exec()
    OR assigned_to_email = auth.email()
  );


-- ═══ ITEM 14: department_budgets company_id allows NULL ═══
-- Migration 024 added company_id without NOT NULL.
-- Backfill NULLs to UTPL first, then add NOT NULL.
UPDATE department_budgets
  SET company_id = (SELECT id FROM companies WHERE short_code = 'UTPL')
  WHERE company_id IS NULL;

ALTER TABLE department_budgets
  ALTER COLUMN company_id SET NOT NULL;


-- ═══ ITEM 17: Sync trigger preserves manual overrides ═══
-- The old trigger unconditionally overwrites all permissions on role change.
-- New version: only reset a column if it currently matches the OLD role defaults.
-- If an admin manually changed a permission, it stays unchanged.

CREATE OR REPLACE FUNCTION sync_member_permissions()
RETURNS TRIGGER AS $fn$
DECLARE
  perm_exists boolean;
  is_admin boolean;
  is_exec boolean;
  is_mgr boolean;
  dept text;
  old_is_admin boolean;
  old_is_exec boolean;
  old_is_mgr boolean;
  old_dept text;
BEGIN
  is_admin := NEW.role = 'Admin';
  is_exec := NEW.role = 'Executive';
  is_mgr := NEW.role = 'Manager';
  dept := NEW.department;

  SELECT EXISTS(
    SELECT 1 FROM member_permissions WHERE member_id = NEW.id
  ) INTO perm_exists;

  IF NOT perm_exists THEN
    INSERT INTO member_permissions (
      member_id,
      can_view_executive_dashboard,
      can_view_operations_dashboard,
      can_view_pa_dashboard,
      can_view_finance,
      can_edit_finance,
      can_view_receivables,
      can_edit_receivables,
      can_see_all_tasks,
      can_create_tasks,
      can_review_tasks,
      can_manage_recurring_tasks,
      can_manage_calendar,
      can_see_all_minutes,
      can_view_dept_ops,
      can_view_dept_hr,
      can_view_dept_tax,
      can_view_dept_audit,
      can_view_dept_admin,
      can_view_dept_it,
      can_view_members,
      can_add_members,
      can_edit_members,
      can_delete_members,
      can_reset_passwords,
      can_view_audit_log,
      can_view_exceptions,
      can_import_export,
      can_access_daily_entry,
      can_view_investments
    ) VALUES (
      NEW.id,
      is_admin,
      is_admin OR is_exec OR (dept = 'Unze Trading Ops'),
      is_admin OR is_exec,
      is_admin OR (is_mgr AND dept = 'Finance'),
      is_admin OR (is_mgr AND dept = 'Finance'),
      is_admin OR (is_mgr AND (dept = 'Finance' OR dept = 'Unze Trading Ops')),
      is_admin OR (is_mgr AND (dept = 'Finance' OR dept = 'Unze Trading Ops')),
      is_admin OR is_exec,
      is_admin OR is_exec,
      is_admin OR is_exec,
      is_admin OR is_exec,
      is_admin OR is_exec,
      is_admin OR is_exec,
      is_admin OR (dept = 'Unze Trading Ops'),
      is_admin OR (dept = 'HR'),
      is_admin OR (dept = 'Tax'),
      is_admin OR (dept = 'Audit'),
      is_admin OR is_exec OR (dept = 'Admin'),
      is_admin OR (dept = 'IT'),
      is_admin OR is_exec,
      is_admin OR is_exec,
      is_admin OR is_exec,
      is_admin OR is_exec,
      is_admin OR is_exec,
      is_admin OR is_exec,
      is_admin OR is_exec,
      is_admin OR is_exec,
      is_admin OR (dept = 'Unze Trading Ops'),
      is_admin
    );
    RETURN NEW;
  END IF;

  -- On role/dept change: only update columns that still match the OLD defaults
  -- This preserves any manual admin overrides
  IF TG_OP = 'UPDATE' AND (
    OLD.role IS DISTINCT FROM NEW.role
    OR OLD.department IS DISTINCT FROM NEW.department
  ) THEN
    old_is_admin := OLD.role = 'Admin';
    old_is_exec := OLD.role = 'Executive';
    old_is_mgr := OLD.role = 'Manager';
    old_dept := OLD.department;

    UPDATE member_permissions SET
      can_view_executive_dashboard = CASE WHEN can_view_executive_dashboard = old_is_admin THEN is_admin ELSE can_view_executive_dashboard END,
      can_view_operations_dashboard = CASE WHEN can_view_operations_dashboard = (old_is_admin OR old_is_exec OR (old_dept = 'Unze Trading Ops')) THEN (is_admin OR is_exec OR (dept = 'Unze Trading Ops')) ELSE can_view_operations_dashboard END,
      can_view_pa_dashboard = CASE WHEN can_view_pa_dashboard = (old_is_admin OR old_is_exec) THEN (is_admin OR is_exec) ELSE can_view_pa_dashboard END,
      can_view_finance = CASE WHEN can_view_finance = (old_is_admin OR (old_is_mgr AND old_dept = 'Finance')) THEN (is_admin OR (is_mgr AND dept = 'Finance')) ELSE can_view_finance END,
      can_edit_finance = CASE WHEN can_edit_finance = (old_is_admin OR (old_is_mgr AND old_dept = 'Finance')) THEN (is_admin OR (is_mgr AND dept = 'Finance')) ELSE can_edit_finance END,
      can_view_receivables = CASE WHEN can_view_receivables = (old_is_admin OR (old_is_mgr AND (old_dept = 'Finance' OR old_dept = 'Unze Trading Ops'))) THEN (is_admin OR (is_mgr AND (dept = 'Finance' OR dept = 'Unze Trading Ops'))) ELSE can_view_receivables END,
      can_edit_receivables = CASE WHEN can_edit_receivables = (old_is_admin OR (old_is_mgr AND (old_dept = 'Finance' OR old_dept = 'Unze Trading Ops'))) THEN (is_admin OR (is_mgr AND (dept = 'Finance' OR dept = 'Unze Trading Ops'))) ELSE can_edit_receivables END,
      can_see_all_tasks = CASE WHEN can_see_all_tasks = (old_is_admin OR old_is_exec) THEN (is_admin OR is_exec) ELSE can_see_all_tasks END,
      can_create_tasks = CASE WHEN can_create_tasks = (old_is_admin OR old_is_exec) THEN (is_admin OR is_exec) ELSE can_create_tasks END,
      can_review_tasks = CASE WHEN can_review_tasks = (old_is_admin OR old_is_exec) THEN (is_admin OR is_exec) ELSE can_review_tasks END,
      can_manage_recurring_tasks = CASE WHEN can_manage_recurring_tasks = (old_is_admin OR old_is_exec) THEN (is_admin OR is_exec) ELSE can_manage_recurring_tasks END,
      can_manage_calendar = CASE WHEN can_manage_calendar = (old_is_admin OR old_is_exec) THEN (is_admin OR is_exec) ELSE can_manage_calendar END,
      can_see_all_minutes = CASE WHEN can_see_all_minutes = (old_is_admin OR old_is_exec) THEN (is_admin OR is_exec) ELSE can_see_all_minutes END,
      can_view_dept_ops = CASE WHEN can_view_dept_ops = (old_is_admin OR (old_dept = 'Unze Trading Ops')) THEN (is_admin OR (dept = 'Unze Trading Ops')) ELSE can_view_dept_ops END,
      can_view_dept_hr = CASE WHEN can_view_dept_hr = (old_is_admin OR (old_dept = 'HR')) THEN (is_admin OR (dept = 'HR')) ELSE can_view_dept_hr END,
      can_view_dept_tax = CASE WHEN can_view_dept_tax = (old_is_admin OR (old_dept = 'Tax')) THEN (is_admin OR (dept = 'Tax')) ELSE can_view_dept_tax END,
      can_view_dept_audit = CASE WHEN can_view_dept_audit = (old_is_admin OR (old_dept = 'Audit')) THEN (is_admin OR (dept = 'Audit')) ELSE can_view_dept_audit END,
      can_view_dept_admin = CASE WHEN can_view_dept_admin = (old_is_admin OR old_is_exec OR (old_dept = 'Admin')) THEN (is_admin OR is_exec OR (dept = 'Admin')) ELSE can_view_dept_admin END,
      can_view_dept_it = CASE WHEN can_view_dept_it = (old_is_admin OR (old_dept = 'IT')) THEN (is_admin OR (dept = 'IT')) ELSE can_view_dept_it END,
      can_view_members = CASE WHEN can_view_members = (old_is_admin OR old_is_exec) THEN (is_admin OR is_exec) ELSE can_view_members END,
      can_add_members = CASE WHEN can_add_members = (old_is_admin OR old_is_exec) THEN (is_admin OR is_exec) ELSE can_add_members END,
      can_edit_members = CASE WHEN can_edit_members = (old_is_admin OR old_is_exec) THEN (is_admin OR is_exec) ELSE can_edit_members END,
      can_delete_members = CASE WHEN can_delete_members = (old_is_admin OR old_is_exec) THEN (is_admin OR is_exec) ELSE can_delete_members END,
      can_reset_passwords = CASE WHEN can_reset_passwords = (old_is_admin OR old_is_exec) THEN (is_admin OR is_exec) ELSE can_reset_passwords END,
      can_view_audit_log = CASE WHEN can_view_audit_log = (old_is_admin OR old_is_exec) THEN (is_admin OR is_exec) ELSE can_view_audit_log END,
      can_view_exceptions = CASE WHEN can_view_exceptions = (old_is_admin OR old_is_exec) THEN (is_admin OR is_exec) ELSE can_view_exceptions END,
      can_import_export = CASE WHEN can_import_export = (old_is_admin OR old_is_exec) THEN (is_admin OR is_exec) ELSE can_import_export END,
      can_access_daily_entry = CASE WHEN can_access_daily_entry = (old_is_admin OR (old_dept = 'Unze Trading Ops')) THEN (is_admin OR (dept = 'Unze Trading Ops')) ELSE can_access_daily_entry END,
      updated_at = now()
    WHERE member_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_member_permissions ON members;
CREATE TRIGGER trg_sync_member_permissions
  AFTER INSERT OR UPDATE ON members
  FOR EACH ROW
  EXECUTE FUNCTION sync_member_permissions();
