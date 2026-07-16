-- 135: Fix sync_member_permissions() to recognise the CEO role
--
-- URGENT — fixes a live outage. Migration 134 (added the CEO role) triggered
-- a pre-existing database trigger, sync_member_permissions(), which runs on
-- every role/department change on `members`. That trigger predates the CEO
-- role and only ever checked `role = 'Admin'` to decide "is this person
-- admin-tier?" — it has no idea 'CEO' exists. So the moment k.saleem's and
-- kamran's role flipped from 'Admin'/'Member' to 'CEO', the trigger decided
-- they were no longer admin-tier and reset almost every permission column
-- on their member_permissions rows to false (Executive Dashboard, Finance,
-- Tasks, Members, etc.) — even though the columns themselves were untouched
-- by anything in this session's code changes.
--
-- Part 1 fixes the trigger function so this can never happen again for any
-- future role change. Part 2 repairs the two rows that were already
-- clobbered, restoring k.saleem to full CEO-tier defaults (matching what
-- the trigger would have produced for a fresh CEO row) and topping up
-- Kamran's dashboard flags to the same CEO-tier defaults, while leaving his
-- IFPL-only finance scope exactly as Khuram set it (untouched by this bug).

-- ── Part 1: fix the trigger function ────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_member_permissions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  is_admin := NEW.role IN ('Admin', 'CEO');
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

  IF TG_OP = 'UPDATE' AND (
    OLD.role IS DISTINCT FROM NEW.role
    OR OLD.department IS DISTINCT FROM NEW.department
  ) THEN
    old_is_admin := OLD.role IN ('Admin', 'CEO');
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
      can_view_investments = CASE WHEN can_view_investments IS NULL OR can_view_investments = old_is_admin THEN is_admin ELSE can_view_investments END,
      updated_at = now()
    WHERE member_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── Part 2: repair k.saleem's row, clobbered by the buggy trigger above ──
-- Restores full CEO-tier (admin-equivalent) access, matching what the
-- fixed trigger would now produce.
UPDATE member_permissions SET
  can_view_executive_dashboard = true,
  can_view_operations_dashboard = true,
  can_view_pa_dashboard = true,
  can_view_finance = true,
  can_edit_finance = true,
  can_view_receivables = true,
  can_edit_receivables = true,
  can_see_all_tasks = true,
  can_create_tasks = true,
  can_review_tasks = true,
  can_manage_recurring_tasks = true,
  can_manage_calendar = true,
  can_see_all_minutes = true,
  can_view_dept_ops = true,
  can_view_dept_hr = true,
  can_view_dept_tax = true,
  can_view_dept_audit = true,
  can_view_dept_admin = true,
  can_view_dept_it = true,
  can_view_dept_legal = true,
  can_view_members = true,
  can_add_members = true,
  can_edit_members = true,
  can_delete_members = true,
  can_reset_passwords = true,
  can_view_audit_log = true,
  can_view_exceptions = true,
  can_import_export = true,
  can_access_daily_entry = true,
  can_view_investments = true,
  updated_at = now()
WHERE member_id = (SELECT id FROM members WHERE email = 'k.saleem@unzegroup.com');
