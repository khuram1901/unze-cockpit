-- ═══ Grant Nadeem Khan (Ops HOD) real delete rights on production/dispatch/breakage entries ═══
-- The app UI (ProductionForm.tsx) already shows him a delete button via a
-- hardcoded email check, but the existing RLS policy only allows
-- is_admin_or_exec(), and Nadeem's role is "Manager" — so his deletes were
-- silently rejected by the database despite the button being visible.

DROP POLICY IF EXISTS "delete_entries" ON production_entries;
CREATE POLICY "delete_entries" ON production_entries FOR DELETE
  USING (is_admin_or_exec() OR auth.email() = 'nadeem.khan@unze.co.uk');

DROP POLICY IF EXISTS "delete_entries" ON dispatch_entries;
CREATE POLICY "delete_entries" ON dispatch_entries FOR DELETE
  USING (is_admin_or_exec() OR auth.email() = 'nadeem.khan@unze.co.uk');

DROP POLICY IF EXISTS "delete_entries" ON breakage_entries;
CREATE POLICY "delete_entries" ON breakage_entries FOR DELETE
  USING (is_admin_or_exec() OR auth.email() = 'nadeem.khan@unze.co.uk');
