-- Migration 041: Re-seed receivable_stages + add bill_type column
-- receivable_stages is REFERENCE data — removed from wipe list so this
-- never happens again.
--
-- Stages reflect the pole utility bill collection lifecycle.
-- Sales Tax and Retention bills skip stage 2 (IC & GRN Obtained).
-- Meter stages TBD.

-- 1. Add bill_type to receivables (Normal / Sales Tax / Retention)
ALTER TABLE receivables ADD COLUMN IF NOT EXISTS bill_type text NOT NULL DEFAULT 'Normal';

-- 2. Clear any partial re-entries and seed the correct 9 stages
DELETE FROM receivable_stages;

INSERT INTO receivable_stages (stage_order, stage_name, working_day_budget) VALUES
  (1, 'Bill Generated',          0),
  (2, 'IC & GRN Obtained',       3),
  (3, 'Submitted to Civil Dept', 2),
  (4, 'Pre-Audit',               3),
  (5, 'Finance Dept',            2),
  (6, 'FD''s Table',             3),
  (7, 'CEO''s Table',            3),
  (8, 'Back to FD Dept',         1),
  (9, 'XEN Signature',           1);
