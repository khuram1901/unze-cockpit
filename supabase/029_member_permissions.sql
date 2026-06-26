-- Migration 029: member_permissions table
-- Per-member permission overrides, toggleable by Admin from the Access Matrix page.
-- Each boolean column defaults to NULL = "use role-based default".
-- When set to TRUE/FALSE it overrides the role default.

CREATE TABLE IF NOT EXISTS member_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,

  -- Dashboards
  can_view_executive_dashboard boolean,
  can_view_operations_dashboard boolean,
  can_view_pa_dashboard boolean,

  -- Finance
  can_view_finance boolean,
  can_edit_finance boolean,
  finance_company_scope text, -- 'UTPL', 'IFPL', 'both', or null (= role default)

  -- Receivables
  can_view_receivables boolean,
  can_edit_receivables boolean,

  -- Tasks & Meetings
  can_see_all_tasks boolean,
  can_create_tasks boolean,
  can_review_tasks boolean,
  can_manage_recurring_tasks boolean,
  can_manage_calendar boolean,
  can_see_all_minutes boolean,

  -- Departments
  can_view_dept_ops boolean,
  can_view_dept_hr boolean,
  can_view_dept_tax boolean,
  can_view_dept_audit boolean,
  can_view_dept_admin boolean,
  can_view_dept_it boolean,

  -- Members Management
  can_view_members boolean,
  can_add_members boolean,
  can_edit_members boolean,
  can_delete_members boolean,
  can_reset_passwords boolean,

  -- Settings / Admin
  can_view_audit_log boolean,
  can_view_exceptions boolean,
  can_import_export boolean,

  -- Production
  can_access_daily_entry boolean,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE(member_id)
);

ALTER TABLE member_permissions ENABLE ROW LEVEL SECURITY;

-- Only admin-tier users can read/write permissions
DROP POLICY IF EXISTS "permissions_admin" ON member_permissions;
CREATE POLICY "permissions_admin" ON member_permissions FOR ALL
  USING (is_admin_tier()) WITH CHECK (is_admin_tier());

-- Seed a row for every existing member (all NULLs = role defaults)
INSERT INTO member_permissions (member_id)
SELECT id FROM members
ON CONFLICT (member_id) DO NOTHING;
