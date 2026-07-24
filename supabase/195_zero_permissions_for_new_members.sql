-- 195: Zero-permission default for all new non-Admin/CEO members
--
-- New rule (Khuram, 24 Jul 2026):
--   Every new member starts with ZERO access except task creation.
--   Khuram must explicitly grant everything else via the Access Matrix.
--
-- This replaces the old behaviour where the trigger inferred permissions
-- from role/department (e.g. a new HR Manager auto-got can_view_dept_hr,
-- a new Finance Manager auto-got can_view_finance, etc.).
--
-- The only exception is Admin/CEO — they still get full access on creation
-- because they are Khuram or another principal account.
--
-- Note: can_create_tasks is left as NULL (not true) because canCreateAssignments()
-- in permissions.ts already returns true when the value is NULL (migration 188
-- set this as the open default). Explicitly storing NULL keeps the Access Matrix
-- clean (no override shown = using default).

CREATE OR REPLACE FUNCTION public.sync_member_permissions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  perm_exists boolean;
  is_admin    boolean;
BEGIN
  is_admin := NEW.role IN ('Admin', 'CEO');

  SELECT EXISTS(
    SELECT 1 FROM member_permissions WHERE member_id = NEW.id
  ) INTO perm_exists;

  -- ── INSERT: new member row ──────────────────────────────────────
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
      can_view_investments,
      can_view_dept_tax_accounts
    ) VALUES (
      NEW.id,
      is_admin,   -- can_view_executive_dashboard
      is_admin,   -- can_view_operations_dashboard
      is_admin,   -- can_view_pa_dashboard
      is_admin,   -- can_view_finance
      is_admin,   -- can_edit_finance
      is_admin,   -- can_view_receivables
      is_admin,   -- can_edit_receivables
      is_admin,   -- can_see_all_tasks
      NULL,       -- can_create_tasks: NULL = use function default (true for all)
      is_admin,   -- can_review_tasks
      is_admin,   -- can_manage_recurring_tasks
      is_admin,   -- can_manage_calendar
      is_admin,   -- can_see_all_minutes
      is_admin,   -- can_view_dept_ops
      is_admin,   -- can_view_dept_hr
      is_admin,   -- can_view_dept_tax
      is_admin,   -- can_view_dept_audit
      is_admin,   -- can_view_dept_admin
      is_admin,   -- can_view_dept_it
      is_admin,   -- can_view_members
      is_admin,   -- can_add_members
      is_admin,   -- can_edit_members
      is_admin,   -- can_delete_members
      is_admin,   -- can_reset_passwords
      is_admin,   -- can_view_audit_log
      is_admin,   -- can_view_exceptions
      is_admin,   -- can_import_export
      is_admin,   -- can_access_daily_entry
      is_admin,   -- can_view_investments
      is_admin    -- can_view_dept_tax_accounts
    );
    RETURN NEW;
  END IF;

  -- ── UPDATE: role/dept changed — do NOT auto-adjust permissions ──
  -- With the zero-permission model, role changes no longer cascade into
  -- permission changes. Khuram grants and revokes everything manually.
  -- (If you want a role change to revoke access, do it in the Access Matrix.)

  RETURN NEW;
END;
$function$;
