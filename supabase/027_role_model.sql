-- ═══════════════════════════════════════════════════════════════════
-- Role model alignment — Executive == PA (limited), NOT full admin.
-- Run this in the Supabase SQL Editor. Supersedes 026 for the helper.
--
-- NEW MEANING:
--   Admin / CEO  → full access (incl. finance, receivables)
--   Executive    → THE PA. NO finance, NO receivables. (Privileged for
--                  tasks/members/etc, but those tables aren't finance.)
--   Manager      → department-scoped
--   Member       → own tasks
--
-- KEY CHANGE: the old is_admin_or_exec() granted Executive full access,
-- which would let the PA read all finance/receivables. We split the tiers.
-- ═══════════════════════════════════════════════════════════════════

-- ── Admin tier: Admin role OR the CEO/Admin emails. NOT Executive. ──
CREATE OR REPLACE FUNCTION is_admin_tier()
RETURNS BOOLEAN AS $$
  SELECT
    auth.email() IN ('k.saleem@unzegroup.com', 'khuram1901@gmail.com')
    OR get_user_role() = 'Admin';
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Keep is_admin_or_exec() as an ALIAS of the admin tier so every existing
-- finance/department policy that references it immediately stops granting
-- Executive/PA access. (Executive is deliberately NOT included anymore.)
CREATE OR REPLACE FUNCTION is_admin_or_exec()
RETURNS BOOLEAN AS $$
  SELECT is_admin_tier();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Privileged tier = admin-tier PLUS the PA (Executive). Used for the
-- operational tables the PA SHOULD manage: tasks and members.
CREATE OR REPLACE FUNCTION is_privileged()
RETURNS BOOLEAN AS $$
  SELECT is_admin_tier() OR get_user_role() = 'Executive';
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ── Re-point TASKS so the PA keeps full task access ───────────────
DROP POLICY IF EXISTS "tasks_select" ON tasks;
DROP POLICY IF EXISTS "tasks_update" ON tasks;
CREATE POLICY "tasks_select" ON tasks FOR SELECT USING (
  is_privileged()
  OR assigned_to_email = auth.email()
  OR assigned_by = (SELECT name FROM members WHERE email = auth.email())
);
CREATE POLICY "tasks_update" ON tasks FOR UPDATE USING (
  is_privileged()
  OR assigned_to_email = auth.email()
);

-- ── Re-point MEMBERS write so the PA can add/manage members ───────
-- (App-level rules restrict the PA to Manager/Member and block editing
--  Admin/CEO — see app/lib/permissions.ts. RLS allows the write tier.)
DROP POLICY IF EXISTS "members_write" ON members;
CREATE POLICY "members_write" ON members FOR ALL
  USING (is_privileged()) WITH CHECK (is_privileged());

-- ── Audit log: PA may read (spec). Admin already could. ──────────
DROP POLICY IF EXISTS "audit_log_read" ON audit_log;
CREATE POLICY "audit_log_read" ON audit_log FOR SELECT USING (is_privileged());

-- ── Finance managers, optionally scoped to their own company ───────
CREATE OR REPLACE FUNCTION is_finance_manager()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM members
    WHERE email = auth.email() AND role = 'Manager' AND department = 'Finance'
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_ops_manager()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM members
    WHERE email = auth.email() AND role = 'Manager' AND department = 'Unze Trading Ops'
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Returns TRUE if the current user may see the given company_id's finance.
-- Admin/CEO and finance managers with no company tag → all companies.
-- A finance manager tagged to a company → only that company.
CREATE OR REPLACE FUNCTION can_see_company_finance(target_company uuid)
RETURNS BOOLEAN AS $$
  SELECT
    is_admin_tier()
    OR (
      is_finance_manager() AND (
        -- no company tag → both companies
        (SELECT company FROM members WHERE email = auth.email()) IS NULL
        OR target_company = (
          SELECT c.id FROM companies c
          JOIN members m ON m.email = auth.email()
          WHERE c.name = m.company
          LIMIT 1
        )
      )
    );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ═══ FINANCE TABLES — Admin/CEO + finance managers (company-scoped) ═══
-- daily_cash_position
DROP POLICY IF EXISTS "admin_only" ON daily_cash_position;
DROP POLICY IF EXISTS "finance_access" ON daily_cash_position;
CREATE POLICY "finance_access" ON daily_cash_position FOR ALL
  USING (can_see_company_finance(company_id))
  WITH CHECK (can_see_company_finance(company_id));

-- monthly_cash_plan
DROP POLICY IF EXISTS "admin_only" ON monthly_cash_plan;
DROP POLICY IF EXISTS "finance_access" ON monthly_cash_plan;
CREATE POLICY "finance_access" ON monthly_cash_plan FOR ALL
  USING (can_see_company_finance(company_id))
  WITH CHECK (can_see_company_finance(company_id));

-- cash_opening_balance
DROP POLICY IF EXISTS "admin_only" ON cash_opening_balance;
DROP POLICY IF EXISTS "finance_access" ON cash_opening_balance;
CREATE POLICY "finance_access" ON cash_opening_balance FOR ALL
  USING (can_see_company_finance(company_id))
  WITH CHECK (can_see_company_finance(company_id));

-- monthly_budgets
DROP POLICY IF EXISTS "admin_only" ON monthly_budgets;
DROP POLICY IF EXISTS "finance_access" ON monthly_budgets;
CREATE POLICY "finance_access" ON monthly_budgets FOR ALL
  USING (can_see_company_finance(company_id))
  WITH CHECK (can_see_company_finance(company_id));

-- quarterly_forecasts
DROP POLICY IF EXISTS "admin_only" ON quarterly_forecasts;
DROP POLICY IF EXISTS "finance_access" ON quarterly_forecasts;
CREATE POLICY "finance_access" ON quarterly_forecasts FOR ALL
  USING (can_see_company_finance(company_id))
  WITH CHECK (can_see_company_finance(company_id));

-- bank_position_snapshots
DROP POLICY IF EXISTS "admin_only" ON bank_position_snapshots;
DROP POLICY IF EXISTS "finance_access" ON bank_position_snapshots;
CREATE POLICY "finance_access" ON bank_position_snapshots FOR ALL
  USING (can_see_company_finance(company_id))
  WITH CHECK (can_see_company_finance(company_id));

-- ═══ RECEIVABLES — Admin/CEO + Finance/Ops managers. NOT the PA. ═══
ALTER TABLE receivables ENABLE ROW LEVEL SECURITY;
ALTER TABLE receivable_stages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for authenticated" ON receivables;
DROP POLICY IF EXISTS "receivables_access" ON receivables;
CREATE POLICY "receivables_access" ON receivables FOR ALL
  USING (is_admin_tier() OR is_finance_manager() OR is_ops_manager())
  WITH CHECK (is_admin_tier() OR is_finance_manager() OR is_ops_manager());

DROP POLICY IF EXISTS "Allow all for authenticated" ON receivable_stages;
DROP POLICY IF EXISTS "receivable_stages_access" ON receivable_stages;
CREATE POLICY "receivable_stages_access" ON receivable_stages FOR ALL
  USING (is_admin_tier() OR is_finance_manager() OR is_ops_manager())
  WITH CHECK (is_admin_tier() OR is_finance_manager() OR is_ops_manager());

-- ═══ GOOGLE OAUTH TOKENS — Admin/CEO only (no PA) ═══
DROP POLICY IF EXISTS "admin_only" ON google_oauth_tokens;
CREATE POLICY "admin_only" ON google_oauth_tokens FOR ALL
  USING (is_admin_tier()) WITH CHECK (is_admin_tier());

-- ═══ DEPARTMENT TABLES — PA may see Admin dept, not HR/Tax/Audit ═══
-- Executive (PA) gets explicit access only to admin_categories / admin_spend.
-- (Audit/HR/Legal stay admin-tier + that department's Manager.)
DROP POLICY IF EXISTS "dept_access" ON admin_categories;
CREATE POLICY "dept_access" ON admin_categories FOR ALL
  USING (is_admin_tier() OR get_user_role() = 'Executive' OR get_user_department() = 'Admin')
  WITH CHECK (is_admin_tier() OR get_user_role() = 'Executive' OR get_user_department() = 'Admin');

DROP POLICY IF EXISTS "dept_access" ON admin_spend;
CREATE POLICY "dept_access" ON admin_spend FOR ALL
  USING (is_admin_tier() OR get_user_role() = 'Executive' OR get_user_department() = 'Admin')
  WITH CHECK (is_admin_tier() OR get_user_role() = 'Executive' OR get_user_department() = 'Admin');

-- NOTE: audit_plan_items, audit_findings, recruitment_positions,
-- performance_evaluations, hr_strategy_goals, legal_notices keep their
-- existing 013 policies (is_admin_or_exec() = now admin-tier, plus their
-- department Manager). Executive/PA is correctly excluded from those.
