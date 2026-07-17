-- Allow Finance department Managers to read/write finance tables
-- Run this in Supabase SQL Editor

CREATE OR REPLACE FUNCTION is_finance_manager()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM members
    WHERE email = auth.email()
    AND role = 'Manager'
    AND department = 'Finance'
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Update finance table policies to include Finance Managers
DROP POLICY IF EXISTS "admin_only" ON daily_cash_position;
CREATE POLICY "finance_access" ON daily_cash_position FOR ALL
  USING (is_admin_or_exec() OR is_finance_manager())
  WITH CHECK (is_admin_or_exec() OR is_finance_manager());

DROP POLICY IF EXISTS "admin_only" ON monthly_cash_plan;
CREATE POLICY "finance_access" ON monthly_cash_plan FOR ALL
  USING (is_admin_or_exec() OR is_finance_manager())
  WITH CHECK (is_admin_or_exec() OR is_finance_manager());

DROP POLICY IF EXISTS "admin_only" ON cash_opening_balance;
CREATE POLICY "finance_access" ON cash_opening_balance FOR ALL
  USING (is_admin_or_exec() OR is_finance_manager())
  WITH CHECK (is_admin_or_exec() OR is_finance_manager());

DROP POLICY IF EXISTS "admin_only" ON monthly_budgets;
CREATE POLICY "finance_access" ON monthly_budgets FOR ALL
  USING (is_admin_or_exec() OR is_finance_manager())
  WITH CHECK (is_admin_or_exec() OR is_finance_manager());

DROP POLICY IF EXISTS "admin_only" ON quarterly_forecasts;
CREATE POLICY "finance_access" ON quarterly_forecasts FOR ALL
  USING (is_admin_or_exec() OR is_finance_manager())
  WITH CHECK (is_admin_or_exec() OR is_finance_manager());
