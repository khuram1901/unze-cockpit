-- Tighten RLS policies
-- Run this in the Supabase SQL Editor
--
-- Strategy:
-- Admin/Executive: full access to everything (checked via members table)
-- Manager: read/write own department data + tasks assigned to them
-- Member: read/write only tasks assigned to them + their own entries
--
-- Helper function to get current user's role
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT COALESCE(
    (SELECT role FROM members WHERE email = auth.email()),
    'Member'
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Helper function to check if user is Admin or Executive
CREATE OR REPLACE FUNCTION is_admin_or_exec()
RETURNS BOOLEAN AS $$
  SELECT get_user_role() IN ('Admin', 'Executive');
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Helper function to get current user's department
CREATE OR REPLACE FUNCTION get_user_department()
RETURNS TEXT AS $$
  SELECT department FROM members WHERE email = auth.email();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ═══ TASKS ═══
-- Admin/Executive: see all. Manager/Member: see tasks assigned to them
DROP POLICY IF EXISTS "Allow all for authenticated" ON tasks;
DROP POLICY IF EXISTS "tasks_select" ON tasks;
DROP POLICY IF EXISTS "tasks_insert" ON tasks;
DROP POLICY IF EXISTS "tasks_update" ON tasks;

CREATE POLICY "tasks_select" ON tasks FOR SELECT USING (
  is_admin_or_exec()
  OR assigned_to_email = auth.email()
  OR assigned_by = (SELECT name FROM members WHERE email = auth.email())
);
CREATE POLICY "tasks_insert" ON tasks FOR INSERT WITH CHECK (true);
CREATE POLICY "tasks_update" ON tasks FOR UPDATE USING (
  is_admin_or_exec()
  OR assigned_to_email = auth.email()
);

-- ═══ MEMBERS ═══
-- Everyone can read (needed for dropdowns). Only Admin can write.
DROP POLICY IF EXISTS "Allow all for authenticated" ON members;
DROP POLICY IF EXISTS "members_select" ON members;
DROP POLICY IF EXISTS "members_write" ON members;

CREATE POLICY "members_select" ON members FOR SELECT USING (true);
CREATE POLICY "members_write" ON members FOR ALL USING (is_admin_or_exec()) WITH CHECK (is_admin_or_exec());

-- ═══ PRODUCTION / DISPATCH / BREAKAGE ═══
-- Everyone authenticated can read (needed for dashboards). Write by anyone (daily entry).
DROP POLICY IF EXISTS "Allow all for authenticated" ON production_entries;
DROP POLICY IF EXISTS "Allow all for authenticated" ON dispatch_entries;
DROP POLICY IF EXISTS "Allow all for authenticated" ON breakage_entries;
DROP POLICY IF EXISTS "Allow all for authenticated" ON scrap_processed_entries;

CREATE POLICY "read_all" ON production_entries FOR SELECT USING (true);
CREATE POLICY "write_all" ON production_entries FOR INSERT WITH CHECK (true);
CREATE POLICY "read_all" ON dispatch_entries FOR SELECT USING (true);
CREATE POLICY "write_all" ON dispatch_entries FOR INSERT WITH CHECK (true);
CREATE POLICY "read_all" ON breakage_entries FOR SELECT USING (true);
CREATE POLICY "write_all" ON breakage_entries FOR INSERT WITH CHECK (true);
CREATE POLICY "read_all" ON scrap_processed_entries FOR SELECT USING (true);
CREATE POLICY "write_all" ON scrap_processed_entries FOR INSERT WITH CHECK (true);

-- ═══ FINANCE TABLES ═══
-- Only Admin/Executive can read/write finance data
DROP POLICY IF EXISTS "Allow all for authenticated" ON daily_cash_position;
DROP POLICY IF EXISTS "Allow all for authenticated" ON monthly_cash_plan;
DROP POLICY IF EXISTS "Allow all for authenticated" ON cash_opening_balance;
DROP POLICY IF EXISTS "Allow all for authenticated" ON bank_position_snapshots;
DROP POLICY IF EXISTS "Allow all for authenticated" ON monthly_budgets;
DROP POLICY IF EXISTS "Allow all for authenticated" ON quarterly_forecasts;

CREATE POLICY "admin_only" ON daily_cash_position FOR ALL USING (is_admin_or_exec()) WITH CHECK (is_admin_or_exec());
CREATE POLICY "admin_only" ON monthly_cash_plan FOR ALL USING (is_admin_or_exec()) WITH CHECK (is_admin_or_exec());
CREATE POLICY "admin_only" ON cash_opening_balance FOR ALL USING (is_admin_or_exec()) WITH CHECK (is_admin_or_exec());
CREATE POLICY "admin_only" ON bank_position_snapshots FOR ALL USING (is_admin_or_exec()) WITH CHECK (is_admin_or_exec());
CREATE POLICY "admin_only" ON monthly_budgets FOR ALL USING (is_admin_or_exec()) WITH CHECK (is_admin_or_exec());
CREATE POLICY "admin_only" ON quarterly_forecasts FOR ALL USING (is_admin_or_exec()) WITH CHECK (is_admin_or_exec());

-- ═══ GOOGLE OAUTH TOKENS ═══
-- Only Admin can read/write (sensitive!)
DROP POLICY IF EXISTS "Allow all for authenticated" ON google_oauth_tokens;
CREATE POLICY "admin_only" ON google_oauth_tokens FOR ALL USING (is_admin_or_exec()) WITH CHECK (is_admin_or_exec());

-- ═══ AUDIT LOG ═══
-- Admin only for reading, anyone can write (logging)
DROP POLICY IF EXISTS "Allow all for authenticated" ON audit_log;
CREATE POLICY "audit_log_read" ON audit_log FOR SELECT USING (get_user_role() = 'Admin');
CREATE POLICY "audit_log_write" ON audit_log FOR INSERT WITH CHECK (true);

-- ═══ DEPARTMENT-SPECIFIC TABLES ═══
-- Admin/Executive: full access. Managers: only if in that department.
DROP POLICY IF EXISTS "Allow all for authenticated" ON audit_plan_items;
DROP POLICY IF EXISTS "Allow all for authenticated" ON audit_findings;
DROP POLICY IF EXISTS "Allow all for authenticated" ON recruitment_positions;
DROP POLICY IF EXISTS "Allow all for authenticated" ON performance_evaluations;
DROP POLICY IF EXISTS "Allow all for authenticated" ON hr_strategy_goals;
DROP POLICY IF EXISTS "Allow all for authenticated" ON legal_notices;
DROP POLICY IF EXISTS "Allow all for authenticated" ON admin_categories;
DROP POLICY IF EXISTS "Allow all for authenticated" ON admin_spend;

CREATE POLICY "dept_access" ON audit_plan_items FOR ALL USING (is_admin_or_exec() OR get_user_department() = 'Audit') WITH CHECK (is_admin_or_exec() OR get_user_department() = 'Audit');
CREATE POLICY "dept_access" ON audit_findings FOR ALL USING (is_admin_or_exec() OR get_user_department() = 'Audit') WITH CHECK (is_admin_or_exec() OR get_user_department() = 'Audit');
CREATE POLICY "dept_access" ON recruitment_positions FOR ALL USING (is_admin_or_exec() OR get_user_department() = 'HR') WITH CHECK (is_admin_or_exec() OR get_user_department() = 'HR');
CREATE POLICY "dept_access" ON performance_evaluations FOR ALL USING (is_admin_or_exec() OR get_user_department() = 'HR') WITH CHECK (is_admin_or_exec() OR get_user_department() = 'HR');
CREATE POLICY "dept_access" ON hr_strategy_goals FOR ALL USING (is_admin_or_exec() OR get_user_department() = 'HR') WITH CHECK (is_admin_or_exec() OR get_user_department() = 'HR');
CREATE POLICY "dept_access" ON legal_notices FOR ALL USING (is_admin_or_exec() OR get_user_department() = 'Tax') WITH CHECK (is_admin_or_exec() OR get_user_department() = 'Tax');
CREATE POLICY "dept_access" ON admin_categories FOR ALL USING (is_admin_or_exec() OR get_user_department() = 'Admin') WITH CHECK (is_admin_or_exec() OR get_user_department() = 'Admin');
CREATE POLICY "dept_access" ON admin_spend FOR ALL USING (is_admin_or_exec() OR get_user_department() = 'Admin') WITH CHECK (is_admin_or_exec() OR get_user_department() = 'Admin');

-- ═══ REMAINING TABLES ═══
-- These stay open for authenticated users (needed across roles)
-- plants, opening_balances, broken_opening_balances, machine_issues,
-- monthly_production_targets, monthly_dispatch_targets, department_owners,
-- member_plants, meeting_requests, meetings, meeting_tasks,
-- companies, receivables, receivable_stages, notification_log
