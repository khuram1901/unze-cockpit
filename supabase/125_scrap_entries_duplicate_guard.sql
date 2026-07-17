-- 125: Add the same UNIQUE(plant_id, entry_date) duplicate-submission
-- guard that production_entries/dispatch_entries/breakage_entries
-- already have, to scrap_processed_entries — found missing during the
-- 15 Jul 2026 full-app audit.
--
-- Four plant/date pairs on the live database already have duplicate
-- scrap rows (all "nothing to report", all quantities zero — checked
-- directly, no real scrap numbers were double-counted). This migration
-- keeps the earliest row for each duplicate pair and deletes the
-- later ones before adding the constraint, since a straight ADD
-- CONSTRAINT would fail against the existing duplicates.
--
-- Apply manually via the Supabase SQL Editor, per project convention.

delete from public.scrap_processed_entries a
using public.scrap_processed_entries b
where a.plant_id = b.plant_id
  and a.entry_date = b.entry_date
  and a.created_at > b.created_at;

alter table public.scrap_processed_entries
  add constraint scrap_processed_entries_plant_date_unique unique (plant_id, entry_date);
