-- Migration 032: Backfill member_permissions for all existing members
--
-- The auto-trigger (031) only fires on INSERT/UPDATE of members.
-- Members created before the trigger have null permission values.
-- This migration sets correct role+department defaults for everyone
-- whose permissions are still null.

UPDATE member_permissions mp SET
  can_view_executive_dashboard = COALESCE(mp.can_view_executive_dashboard, m.role = 'Admin'),
  can_view_operations_dashboard = COALESCE(mp.can_view_operations_dashboard, m.role = 'Admin' OR m.role = 'Executive' OR m.department = 'Unze Trading Ops'),
  can_view_pa_dashboard = COALESCE(mp.can_view_pa_dashboard, m.role = 'Admin' OR m.role = 'Executive'),
  can_view_finance = COALESCE(mp.can_view_finance, m.role = 'Admin' OR (m.role = 'Manager' AND m.department = 'Finance')),
  can_edit_finance = COALESCE(mp.can_edit_finance, m.role = 'Admin' OR (m.role = 'Manager' AND m.department = 'Finance')),
  can_view_receivables = COALESCE(mp.can_view_receivables, m.role = 'Admin' OR (m.role = 'Manager' AND (m.department = 'Finance' OR m.department = 'Unze Trading Ops'))),
  can_edit_receivables = COALESCE(mp.can_edit_receivables, m.role = 'Admin' OR (m.role = 'Manager' AND (m.department = 'Finance' OR m.department = 'Unze Trading Ops'))),
  can_see_all_tasks = COALESCE(mp.can_see_all_tasks, m.role = 'Admin' OR m.role = 'Executive'),
  can_create_tasks = COALESCE(mp.can_create_tasks, m.role = 'Admin' OR m.role = 'Executive'),
  can_review_tasks = COALESCE(mp.can_review_tasks, m.role = 'Admin' OR m.role = 'Executive'),
  can_manage_recurring_tasks = COALESCE(mp.can_manage_recurring_tasks, m.role = 'Admin' OR m.role = 'Executive'),
  can_manage_calendar = COALESCE(mp.can_manage_calendar, m.role = 'Admin' OR m.role = 'Executive'),
  can_see_all_minutes = COALESCE(mp.can_see_all_minutes, m.role = 'Admin' OR m.role = 'Executive'),
  can_view_dept_ops = COALESCE(mp.can_view_dept_ops, m.role = 'Admin' OR m.department = 'Unze Trading Ops'),
  can_view_dept_hr = COALESCE(mp.can_view_dept_hr, m.role = 'Admin' OR m.department = 'HR'),
  can_view_dept_tax = COALESCE(mp.can_view_dept_tax, m.role = 'Admin' OR m.department = 'Tax'),
  can_view_dept_audit = COALESCE(mp.can_view_dept_audit, m.role = 'Admin' OR m.department = 'Audit'),
  can_view_dept_admin = COALESCE(mp.can_view_dept_admin, m.role = 'Admin' OR m.role = 'Executive' OR m.department = 'Admin'),
  can_view_dept_it = COALESCE(mp.can_view_dept_it, m.role = 'Admin' OR m.department = 'IT'),
  can_view_members = COALESCE(mp.can_view_members, m.role = 'Admin' OR m.role = 'Executive'),
  can_add_members = COALESCE(mp.can_add_members, m.role = 'Admin' OR m.role = 'Executive'),
  can_edit_members = COALESCE(mp.can_edit_members, m.role = 'Admin' OR m.role = 'Executive'),
  can_delete_members = COALESCE(mp.can_delete_members, m.role = 'Admin' OR m.role = 'Executive'),
  can_reset_passwords = COALESCE(mp.can_reset_passwords, m.role = 'Admin' OR m.role = 'Executive'),
  can_view_audit_log = COALESCE(mp.can_view_audit_log, m.role = 'Admin' OR m.role = 'Executive'),
  can_view_exceptions = COALESCE(mp.can_view_exceptions, m.role = 'Admin' OR m.role = 'Executive'),
  can_import_export = COALESCE(mp.can_import_export, m.role = 'Admin' OR m.role = 'Executive'),
  can_access_daily_entry = COALESCE(mp.can_access_daily_entry, m.role = 'Admin' OR m.department = 'Unze Trading Ops'),
  updated_at = now()
FROM members m
WHERE mp.member_id = m.id;

-- Also insert rows for any members who don't have a member_permissions row at all
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
)
SELECT
  m.id,
  m.role = 'Admin',
  m.role = 'Admin' OR m.role = 'Executive' OR m.department = 'Unze Trading Ops',
  m.role = 'Admin' OR m.role = 'Executive',
  m.role = 'Admin' OR (m.role = 'Manager' AND m.department = 'Finance'),
  m.role = 'Admin' OR (m.role = 'Manager' AND m.department = 'Finance'),
  m.role = 'Admin' OR (m.role = 'Manager' AND (m.department = 'Finance' OR m.department = 'Unze Trading Ops')),
  m.role = 'Admin' OR (m.role = 'Manager' AND (m.department = 'Finance' OR m.department = 'Unze Trading Ops')),
  m.role = 'Admin' OR m.role = 'Executive',
  m.role = 'Admin' OR m.role = 'Executive',
  m.role = 'Admin' OR m.role = 'Executive',
  m.role = 'Admin' OR m.role = 'Executive',
  m.role = 'Admin' OR m.role = 'Executive',
  m.role = 'Admin' OR m.role = 'Executive',
  m.role = 'Admin' OR m.department = 'Unze Trading Ops',
  m.role = 'Admin' OR m.department = 'HR',
  m.role = 'Admin' OR m.department = 'Tax',
  m.role = 'Admin' OR m.department = 'Audit',
  m.role = 'Admin' OR m.role = 'Executive' OR m.department = 'Admin',
  m.role = 'Admin' OR m.department = 'IT',
  m.role = 'Admin' OR m.role = 'Executive',
  m.role = 'Admin' OR m.role = 'Executive',
  m.role = 'Admin' OR m.role = 'Executive',
  m.role = 'Admin' OR m.role = 'Executive',
  m.role = 'Admin' OR m.role = 'Executive',
  m.role = 'Admin' OR m.role = 'Executive',
  m.role = 'Admin' OR m.role = 'Executive',
  m.role = 'Admin' OR m.role = 'Executive',
  m.role = 'Admin' OR m.department = 'Unze Trading Ops'
FROM members m
WHERE NOT EXISTS (SELECT 1 FROM member_permissions WHERE member_id = m.id);
