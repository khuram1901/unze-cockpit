-- Migration 200: Fix department_budgets SELECT RLS
-- Migration 024 created USING (true) which allows any authenticated user to read
-- all budget data across all companies. This tightens it to admins and finance managers only.
-- PA role must never see financial data (CLAUDE.md rule 6).

DROP POLICY IF EXISTS "budget_select" ON department_budgets;

CREATE POLICY department_budgets_select
  ON department_budgets
  FOR SELECT
  TO authenticated
  USING (is_admin_tier() OR is_finance_manager());
