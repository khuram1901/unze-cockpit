-- Migration 030: Wire member_permissions overrides into RLS
--
-- Each helper now checks the override column first. If non-null, the
-- override wins. If null, the role-based default applies.

-- Helper: check a boolean override for the current user
CREATE OR REPLACE FUNCTION perm_override(col_name text)
RETURNS boolean AS $$
DECLARE
  val boolean;
BEGIN
  EXECUTE format(
    'SELECT %I FROM member_permissions WHERE member_id = (SELECT id FROM members WHERE email = auth.email() LIMIT 1)',
    col_name
  ) INTO val;
  RETURN val;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Finance: override can_view_finance trumps role default
CREATE OR REPLACE FUNCTION can_see_company_finance(target_company uuid)
RETURNS BOOLEAN AS $$
DECLARE
  ov boolean;
BEGIN
  ov := perm_override('can_view_finance');
  IF ov IS NOT NULL THEN
    IF ov = false THEN RETURN false; END IF;
    -- override = true, check company scope
    RETURN target_company IS NULL
      OR target_company = (
        SELECT c.id FROM companies c
        JOIN members m ON m.email = auth.email()
        WHERE c.name = m.company LIMIT 1
      )
      OR is_admin_tier()
      OR (SELECT finance_company_scope FROM member_permissions
          WHERE member_id = (SELECT id FROM members WHERE email = auth.email() LIMIT 1)) = 'both'
      OR (SELECT finance_company_scope FROM member_permissions
          WHERE member_id = (SELECT id FROM members WHERE email = auth.email() LIMIT 1)) IS NULL;
  END IF;
  -- No override: original role-based logic
  RETURN is_admin_tier()
    OR (
      is_finance_manager() AND (
        (SELECT company FROM members WHERE email = auth.email()) IS NULL
        OR target_company = (
          SELECT c.id FROM companies c
          JOIN members m ON m.email = auth.email()
          WHERE c.name = m.company LIMIT 1
        )
      )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Receivables: override can_view_receivables
CREATE OR REPLACE FUNCTION can_access_receivables()
RETURNS BOOLEAN AS $$
DECLARE
  ov boolean;
BEGIN
  ov := perm_override('can_view_receivables');
  IF ov IS NOT NULL THEN RETURN ov; END IF;
  RETURN is_admin_tier() OR is_finance_manager() OR is_ops_manager();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Update receivables policies to use the new function
DROP POLICY IF EXISTS "receivables_access" ON receivables;
CREATE POLICY "receivables_access" ON receivables FOR ALL
  USING (can_access_receivables()) WITH CHECK (can_access_receivables());

DROP POLICY IF EXISTS "receivable_stages_access" ON receivable_stages;
CREATE POLICY "receivable_stages_access" ON receivable_stages FOR ALL
  USING (can_access_receivables()) WITH CHECK (can_access_receivables());

-- Tasks: override can_see_all_tasks / can_create_tasks / can_review_tasks
CREATE OR REPLACE FUNCTION can_access_all_tasks()
RETURNS BOOLEAN AS $$
DECLARE
  ov boolean;
BEGIN
  ov := perm_override('can_see_all_tasks');
  IF ov IS NOT NULL THEN RETURN ov; END IF;
  RETURN is_privileged();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

DROP POLICY IF EXISTS "tasks_select" ON tasks;
CREATE POLICY "tasks_select" ON tasks FOR SELECT USING (
  can_access_all_tasks()
  OR assigned_to_email = auth.email()
  OR assigned_by = (SELECT name FROM members WHERE email = auth.email())
);

DROP POLICY IF EXISTS "tasks_update" ON tasks;
CREATE POLICY "tasks_update" ON tasks FOR UPDATE USING (
  can_access_all_tasks()
  OR assigned_to_email = auth.email()
);

-- Members: override can_view_members / can_edit_members
CREATE OR REPLACE FUNCTION can_manage_members_rls()
RETURNS BOOLEAN AS $$
DECLARE
  ov boolean;
BEGIN
  ov := perm_override('can_view_members');
  IF ov IS NOT NULL THEN RETURN ov; END IF;
  RETURN is_privileged();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

DROP POLICY IF EXISTS "members_write" ON members;
DROP POLICY IF EXISTS "members_insert" ON members;
DROP POLICY IF EXISTS "members_update" ON members;
DROP POLICY IF EXISTS "members_delete" ON members;
CREATE POLICY "members_insert" ON members FOR INSERT
  WITH CHECK (can_manage_members_rls());
CREATE POLICY "members_update" ON members FOR UPDATE
  USING (can_manage_members_rls());
CREATE POLICY "members_delete" ON members FOR DELETE
  USING (can_manage_members_rls());

-- Audit log: override can_view_audit_log
CREATE OR REPLACE FUNCTION can_view_audit_log_rls()
RETURNS BOOLEAN AS $$
DECLARE
  ov boolean;
BEGIN
  ov := perm_override('can_view_audit_log');
  IF ov IS NOT NULL THEN RETURN ov; END IF;
  RETURN is_privileged();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

DROP POLICY IF EXISTS "audit_log_read" ON audit_log;
CREATE POLICY "audit_log_read" ON audit_log FOR SELECT USING (can_view_audit_log_rls());
