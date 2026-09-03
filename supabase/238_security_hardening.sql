-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 238 — Security hardening: tighten overly-permissive RLS policies
-- Applied: 2026-09-03
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. balance_sheet ──────────────────────────────────────────────────────────
-- Was: SELECT/UPDATE qual = true (any authenticated user), INSERT unrestricted
DROP POLICY IF EXISTS balance_sheet_select ON balance_sheet;
DROP POLICY IF EXISTS balance_sheet_insert ON balance_sheet;
DROP POLICY IF EXISTS balance_sheet_update ON balance_sheet;

CREATE POLICY balance_sheet_select ON balance_sheet
  FOR SELECT TO authenticated USING (is_finance() OR is_admin_tier());
CREATE POLICY balance_sheet_insert ON balance_sheet
  FOR INSERT TO authenticated WITH CHECK (is_admin_tier());
CREATE POLICY balance_sheet_update ON balance_sheet
  FOR UPDATE TO authenticated USING (is_admin_tier()) WITH CHECK (is_admin_tier());

-- ── 2. balance_sheet_ifl ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS balance_sheet_ifl_select ON balance_sheet_ifl;
DROP POLICY IF EXISTS balance_sheet_ifl_insert ON balance_sheet_ifl;
DROP POLICY IF EXISTS balance_sheet_ifl_update ON balance_sheet_ifl;

CREATE POLICY balance_sheet_ifl_select ON balance_sheet_ifl
  FOR SELECT TO authenticated USING (is_finance() OR is_admin_tier());
CREATE POLICY balance_sheet_ifl_insert ON balance_sheet_ifl
  FOR INSERT TO authenticated WITH CHECK (is_admin_tier());
CREATE POLICY balance_sheet_ifl_update ON balance_sheet_ifl
  FOR UPDATE TO authenticated USING (is_admin_tier()) WITH CHECK (is_admin_tier());

-- ── 3. flw_salary_setup ───────────────────────────────────────────────────────
-- Was: SELECT qual = true (any authenticated user could read all salary data)
DROP POLICY IF EXISTS authenticated_read_flw_salary_setup ON flw_salary_setup;
CREATE POLICY flw_salary_setup_read ON flw_salary_setup
  FOR SELECT TO authenticated USING (is_privileged());

-- ── 4. portfolio_snapshots ────────────────────────────────────────────────────
-- Was: SELECT qual = true (any authenticated user)
DROP POLICY IF EXISTS authenticated_read_snapshots ON portfolio_snapshots;
CREATE POLICY portfolio_snapshots_read ON portfolio_snapshots
  FOR SELECT TO authenticated USING (is_privileged());

-- ── 5. sell_transactions ──────────────────────────────────────────────────────
-- Was: ALL qual = true for authenticated (full read/write to any logged-in user)
DROP POLICY IF EXISTS "Authenticated full access" ON sell_transactions;
CREATE POLICY sell_transactions_read   ON sell_transactions FOR SELECT TO authenticated USING (is_privileged());
CREATE POLICY sell_transactions_write  ON sell_transactions FOR INSERT TO authenticated WITH CHECK (is_admin_tier());
CREATE POLICY sell_transactions_update ON sell_transactions FOR UPDATE TO authenticated USING (is_admin_tier()) WITH CHECK (is_admin_tier());
CREATE POLICY sell_transactions_delete ON sell_transactions FOR DELETE TO authenticated USING (is_admin_tier());
CREATE POLICY sell_transactions_service ON sell_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 6. holdings INSERT ────────────────────────────────────────────────────────
-- Was: WITH CHECK = null (unrestricted insert for any authenticated user)
DROP POLICY IF EXISTS holdings_admin_write ON holdings;
CREATE POLICY holdings_admin_write ON holdings FOR INSERT TO authenticated WITH CHECK (is_admin_tier());

-- ── 7. price_history INSERT ───────────────────────────────────────────────────
-- Was: WITH CHECK = null (unrestricted insert for any authenticated user)
DROP POLICY IF EXISTS price_history_admin_write ON price_history;
CREATE POLICY price_history_admin_write ON price_history FOR INSERT TO authenticated WITH CHECK (is_admin_tier());
