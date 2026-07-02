-- ═══ Allow all Ops Managers to delete production/dispatch/breakage entries ═══
-- Previously restricted to Nadeem Khan only (migration 043).
-- All 4 Ops Managers (Nadeem, Asif, Usman, Yahya) should be able to
-- correct mistakes by deleting and re-entering.

DROP POLICY IF EXISTS "delete_entries" ON production_entries;
CREATE POLICY "delete_entries" ON production_entries FOR DELETE
  USING (is_admin_tier() OR is_ops_manager());

DROP POLICY IF EXISTS "delete_entries" ON dispatch_entries;
CREATE POLICY "delete_entries" ON dispatch_entries FOR DELETE
  USING (is_admin_tier() OR is_ops_manager());

DROP POLICY IF EXISTS "delete_entries" ON breakage_entries;
CREATE POLICY "delete_entries" ON breakage_entries FOR DELETE
  USING (is_admin_tier() OR is_ops_manager());
