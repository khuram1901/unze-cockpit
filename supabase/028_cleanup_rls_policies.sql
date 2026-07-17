-- Migration 028: remove leftover permissive RLS policies that bypass 027.
--
-- Several policies were created directly in the Supabase dashboard (not in
-- migrations) with permissive predicates like USING (true) or
-- USING (auth.role() = 'authenticated'). Because Postgres ORs permissive
-- policies together, these let ANY authenticated user (incl. the PA) read
-- finance and receivables data, defeating migration 027.
--
-- This drops ALL policies on the affected tables and recreates a single,
-- correct policy per table. Run in the Supabase SQL Editor.

-- ── FINANCE TABLES: only admin-tier + finance managers (company scoped) ──
-- daily_cash_position
DROP POLICY IF EXISTS "finance_access"  ON daily_cash_position;
DROP POLICY IF EXISTS "finance_read"    ON daily_cash_position;
DROP POLICY IF EXISTS "finance_write"   ON daily_cash_position;
DROP POLICY IF EXISTS "finance_update"  ON daily_cash_position;
DROP POLICY IF EXISTS "admin_only"      ON daily_cash_position;
CREATE POLICY "finance_access" ON daily_cash_position FOR ALL
  USING (can_see_company_finance(company_id))
  WITH CHECK (can_see_company_finance(company_id));

-- monthly_cash_plan
DROP POLICY IF EXISTS "finance_access"  ON monthly_cash_plan;
DROP POLICY IF EXISTS "finance_read"    ON monthly_cash_plan;
DROP POLICY IF EXISTS "finance_write"   ON monthly_cash_plan;
DROP POLICY IF EXISTS "finance_update"  ON monthly_cash_plan;
DROP POLICY IF EXISTS "admin_only"      ON monthly_cash_plan;
CREATE POLICY "finance_access" ON monthly_cash_plan FOR ALL
  USING (can_see_company_finance(company_id))
  WITH CHECK (can_see_company_finance(company_id));

-- cash_opening_balance
DROP POLICY IF EXISTS "finance_access"  ON cash_opening_balance;
DROP POLICY IF EXISTS "finance_read"    ON cash_opening_balance;
DROP POLICY IF EXISTS "finance_write"   ON cash_opening_balance;
DROP POLICY IF EXISTS "finance_update"  ON cash_opening_balance;
DROP POLICY IF EXISTS "admin_only"      ON cash_opening_balance;
CREATE POLICY "finance_access" ON cash_opening_balance FOR ALL
  USING (can_see_company_finance(company_id))
  WITH CHECK (can_see_company_finance(company_id));

-- monthly_budgets
DROP POLICY IF EXISTS "finance_access"  ON monthly_budgets;
DROP POLICY IF EXISTS "finance_read"    ON monthly_budgets;
DROP POLICY IF EXISTS "finance_write"   ON monthly_budgets;
DROP POLICY IF EXISTS "finance_update"  ON monthly_budgets;
DROP POLICY IF EXISTS "admin_only"      ON monthly_budgets;
CREATE POLICY "finance_access" ON monthly_budgets FOR ALL
  USING (can_see_company_finance(company_id))
  WITH CHECK (can_see_company_finance(company_id));

-- quarterly_forecasts
DROP POLICY IF EXISTS "finance_access"  ON quarterly_forecasts;
DROP POLICY IF EXISTS "finance_read"    ON quarterly_forecasts;
DROP POLICY IF EXISTS "finance_write"   ON quarterly_forecasts;
DROP POLICY IF EXISTS "finance_update"  ON quarterly_forecasts;
DROP POLICY IF EXISTS "admin_only"      ON quarterly_forecasts;
CREATE POLICY "finance_access" ON quarterly_forecasts FOR ALL
  USING (can_see_company_finance(company_id))
  WITH CHECK (can_see_company_finance(company_id));

-- bank_position_snapshots
DROP POLICY IF EXISTS "finance_access"  ON bank_position_snapshots;
DROP POLICY IF EXISTS "finance_read"    ON bank_position_snapshots;
DROP POLICY IF EXISTS "finance_write"   ON bank_position_snapshots;
DROP POLICY IF EXISTS "finance_update"  ON bank_position_snapshots;
DROP POLICY IF EXISTS "admin_only"      ON bank_position_snapshots;
CREATE POLICY "finance_access" ON bank_position_snapshots FOR ALL
  USING (can_see_company_finance(company_id))
  WITH CHECK (can_see_company_finance(company_id));

-- ── RECEIVABLES: only admin-tier + finance/ops managers ──
DROP POLICY IF EXISTS "receivables_access"   ON receivables;
DROP POLICY IF EXISTS "receivables_read_all" ON receivables;
DROP POLICY IF EXISTS "receivables_insert"   ON receivables;
DROP POLICY IF EXISTS "receivables_update"   ON receivables;
DROP POLICY IF EXISTS "receivables_delete"   ON receivables;
DROP POLICY IF EXISTS "Allow all for authenticated" ON receivables;
CREATE POLICY "receivables_access" ON receivables FOR ALL
  USING (is_admin_tier() OR is_finance_manager() OR is_ops_manager())
  WITH CHECK (is_admin_tier() OR is_finance_manager() OR is_ops_manager());

-- ── RECEIVABLE STAGES: same audience ──
DROP POLICY IF EXISTS "receivable_stages_access" ON receivable_stages;
DROP POLICY IF EXISTS "stages_read_all"          ON receivable_stages;
DROP POLICY IF EXISTS "stages_admin"             ON receivable_stages;
DROP POLICY IF EXISTS "Allow all for authenticated" ON receivable_stages;
CREATE POLICY "receivable_stages_access" ON receivable_stages FOR ALL
  USING (is_admin_tier() OR is_finance_manager() OR is_ops_manager())
  WITH CHECK (is_admin_tier() OR is_finance_manager() OR is_ops_manager());
