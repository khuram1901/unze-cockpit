-- Migration 203: Tighten SELECT RLS on guarantees and guarantee_facilities
-- Migration 060 created USING (true) SELECT policies, meaning any authenticated
-- user (ops team, PA, new members) could read all bank guarantee data.
-- Guarantees are financial data — PA must never see them (CLAUDE.md rule 6).
-- Tighten to admin tier + finance managers only, matching department_budgets (migration 200).

DROP POLICY IF EXISTS "auth_read_guarantee_facilities" ON guarantee_facilities;
DROP POLICY IF EXISTS "auth_read_guarantees"           ON guarantees;

CREATE POLICY guarantee_facilities_select
  ON guarantee_facilities
  FOR SELECT
  TO authenticated
  USING (is_admin_tier() OR is_finance_manager());

CREATE POLICY guarantees_select
  ON guarantees
  FOR SELECT
  TO authenticated
  USING (is_admin_tier() OR is_finance_manager());
