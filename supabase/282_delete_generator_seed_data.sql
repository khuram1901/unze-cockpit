-- Migration 282: Delete all seeded generator fuel and maintenance data
-- Purpose: Clean slate — remove all seed/test data before live operations begin
-- Applied manually via Supabase SQL Editor
--
-- ROLLBACK: Data cannot be recovered after this — ensure you have a backup if needed.

DELETE FROM generator_fuel_log;
DELETE FROM generator_maintenance_log;

SELECT
  (SELECT COUNT(*) FROM generator_fuel_log)        AS fuel_rows_remaining,
  (SELECT COUNT(*) FROM generator_maintenance_log) AS maint_rows_remaining;
