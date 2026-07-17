-- Migration 031: Auto-create and auto-update member_permissions
--
-- A database trigger ensures that:
--   1. Every new member gets a member_permissions row with role+dept defaults
--   2. When a member's role or department changes, their permissions are
--      reset to the new role defaults (unless manually overridden)
--
-- This guarantees permissions are always in sync, whether a member is
-- added via the UI, CSV import, or direct SQL.

CREATE OR REPLACE FUNCTION sync_member_permissions()
RETURNS TRIGGER AS $fn$
DECLARE
  perm_exists boolean;
  is_admin boolean;
  is_exec boolean;
  is_mgr boolean;
  dept text;
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
      can_access_daily_entry
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
      is_admin OR (dept = 'Unze Trading Ops')
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND (
    OLD.role IS DISTINCT FROM NEW.role
    OR OLD.department IS DISTINCT FROM NEW.department
  ) THEN
    UPDATE member_permissions SET
      can_view_executive_dashboard = is_admin,
      can_view_operations_dashboard = is_admin OR is_exec OR (dept = 'Unze Trading Ops'),
      can_view_pa_dashboard = is_admin OR is_exec,
      can_view_finance = is_admin OR (is_mgr AND dept = 'Finance'),
      can_edit_finance = is_admin OR (is_mgr AND dept = 'Finance'),
      can_view_receivables = is_admin OR (is_mgr AND (dept = 'Finance' OR dept = 'Unze Trading Ops')),
      can_edit_receivables = is_admin OR (is_mgr AND (dept = 'Finance' OR dept = 'Unze Trading Ops')),
      can_see_all_tasks = is_admin OR is_exec,
      can_create_tasks = is_admin OR is_exec,
      can_review_tasks = is_admin OR is_exec,
      can_manage_recurring_tasks = is_admin OR is_exec,
      can_manage_calendar = is_admin OR is_exec,
      can_see_all_minutes = is_admin OR is_exec,
      can_view_dept_ops = is_admin OR (dept = 'Unze Trading Ops'),
      can_view_dept_hr = is_admin OR (dept = 'HR'),
      can_view_dept_tax = is_admin OR (dept = 'Tax'),
      can_view_dept_audit = is_admin OR (dept = 'Audit'),
      can_view_dept_admin = is_admin OR is_exec OR (dept = 'Admin'),
      can_view_dept_it = is_admin OR (dept = 'IT'),
      can_view_members = is_admin OR is_exec,
      can_add_members = is_admin OR is_exec,
      can_edit_members = is_admin OR is_exec,
      can_delete_members = is_admin OR is_exec,
      can_reset_passwords = is_admin OR is_exec,
      can_view_audit_log = is_admin OR is_exec,
      can_view_exceptions = is_admin OR is_exec,
      can_import_export = is_admin OR is_exec,
      can_access_daily_entry = is_admin OR (dept = 'Unze Trading Ops'),
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
