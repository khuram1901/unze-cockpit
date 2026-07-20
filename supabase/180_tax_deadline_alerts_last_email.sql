-- Catch-up migration: add last_email_sent_at to tax_deadline_alerts
-- This column is read and written by taxAlertEngine.ts (lines 545, 576)
-- but was added to the live database ad hoc without a migration record.
-- Safe to run when the column already exists (ADD COLUMN IF NOT EXISTS).

alter table public.tax_deadline_alerts
  add column if not exists last_email_sent_at timestamptz;
