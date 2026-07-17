-- ═══ Prevent duplicate production/dispatch/breakage entries at the DB level ═══
-- The June 29 "fix" (commit 04cdc4d) only added a client-side check that reads
-- already-loaded React state (hasEntryFor in ProductionForm.tsx). That check is
-- racy: two near-simultaneous submits (e.g. two people, or a slow connection +
-- retry) both read "no entry yet" before either submit lands, so both succeed.
-- There was never a database constraint backing it up. Confirmed live: a
-- duplicate row was successfully inserted via direct API call on 2026-06-30,
-- a full day after the client-side fix had already deployed.
--
-- Step 1: de-duplicate existing rows, keeping the most recently created entry
-- per (plant_id, entry_date) in each table and discarding older duplicates.
-- Step 2: add a real UNIQUE constraint so the database itself rejects repeats,
-- closing the race condition regardless of client-side timing.

DELETE FROM production_entries a USING production_entries b
  WHERE a.plant_id = b.plant_id
    AND a.entry_date = b.entry_date
    AND a.created_at < b.created_at;

DELETE FROM dispatch_entries a USING dispatch_entries b
  WHERE a.plant_id = b.plant_id
    AND a.entry_date = b.entry_date
    AND a.created_at < b.created_at;

DELETE FROM breakage_entries a USING breakage_entries b
  WHERE a.plant_id = b.plant_id
    AND a.entry_date = b.entry_date
    AND a.created_at < b.created_at;

ALTER TABLE production_entries
  ADD CONSTRAINT production_entries_plant_date_unique UNIQUE (plant_id, entry_date);

ALTER TABLE dispatch_entries
  ADD CONSTRAINT dispatch_entries_plant_date_unique UNIQUE (plant_id, entry_date);

ALTER TABLE breakage_entries
  ADD CONSTRAINT breakage_entries_plant_date_unique UNIQUE (plant_id, entry_date);
