-- Migration 046: Grant PA (Executive role) read-only access to investments
-- holdings/price_history were locked to CEO/Admin only (migration 038).
-- The PA should be able to VIEW the portfolio but never add/edit/delete
-- holdings, set manual prices, or trigger price refreshes.

DROP POLICY IF EXISTS "holdings_admin_read" ON holdings;
CREATE POLICY "holdings_pa_read"
  ON holdings FOR SELECT
  TO authenticated
  USING (is_privileged());

DROP POLICY IF EXISTS "price_history_admin_read" ON price_history;
CREATE POLICY "price_history_pa_read"
  ON price_history FOR SELECT
  TO authenticated
  USING (is_privileged());

-- Write policies (insert/update/delete) are untouched and remain
-- restricted to CEO/Admin only via holdings_admin_write/update/delete
-- and price_history_admin_write/update.
