-- Migration 199: Cash Sheet tracking
-- Stores daily bank position PDFs with full payment & receipt detail per company.
-- Run in Supabase SQL Editor.
--
-- BEFORE RUNNING: Create a private Storage bucket named "cash-sheets" in the
-- Supabase Dashboard → Storage → New Bucket → Name: cash-sheets, Public: OFF.

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cash_sheet_uploads (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  company              TEXT          NOT NULL CHECK (company IN ('IFPL', 'UTPL')),
  sheet_date           DATE          NOT NULL,
  source               TEXT          NOT NULL DEFAULT 'manual_upload'
                                     CHECK (source IN ('manual_upload', 'email')),
  email_message_id     TEXT,                         -- set when ingested from email
  pdf_storage_path     TEXT,                         -- Supabase Storage object path
  opening_balance_pkr  NUMERIC(18,2),
  closing_balance_pkr  NUMERIC(18,2),
  total_receipts_pkr   NUMERIC(18,2) GENERATED ALWAYS AS (NULL) STORED, -- computed via view
  total_payments_pkr   NUMERIC(18,2) GENERATED ALWAYS AS (NULL) STORED,
  notes                TEXT,
  uploaded_by          TEXT          NOT NULL,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (company, sheet_date)
);

-- Drop the generated columns (they need to be computed differently in Postgres)
ALTER TABLE cash_sheet_uploads
  DROP COLUMN IF EXISTS total_receipts_pkr,
  DROP COLUMN IF EXISTS total_payments_pkr;

CREATE TABLE IF NOT EXISTS cash_sheet_transactions (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id     UUID          NOT NULL REFERENCES cash_sheet_uploads(id) ON DELETE CASCADE,
  company      TEXT          NOT NULL,
  sheet_date   DATE          NOT NULL,
  txn_type     TEXT          NOT NULL CHECK (txn_type IN ('payment', 'receipt')),
  description  TEXT          NOT NULL,
  amount_pkr   NUMERIC(18,2) NOT NULL CHECK (amount_pkr > 0),
  bank_account TEXT,
  reference    TEXT,
  category     TEXT,
  sort_order   INT           NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_cash_sheet_company_date
  ON cash_sheet_uploads (company, sheet_date DESC);

CREATE INDEX IF NOT EXISTS idx_cash_txn_sheet_id
  ON cash_sheet_transactions (sheet_id);

CREATE INDEX IF NOT EXISTS idx_cash_txn_company_date
  ON cash_sheet_transactions (company, sheet_date DESC);

-- ── Convenience view ─────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW cash_sheet_summary AS
SELECT
  u.id,
  u.company,
  u.sheet_date,
  u.source,
  u.pdf_storage_path,
  u.opening_balance_pkr,
  u.closing_balance_pkr,
  u.notes,
  u.uploaded_by,
  u.created_at,
  COALESCE(SUM(t.amount_pkr) FILTER (WHERE t.txn_type = 'receipt'), 0) AS total_receipts_pkr,
  COALESCE(SUM(t.amount_pkr) FILTER (WHERE t.txn_type = 'payment'), 0) AS total_payments_pkr,
  COUNT(t.id) AS transaction_count
FROM cash_sheet_uploads u
LEFT JOIN cash_sheet_transactions t ON t.sheet_id = u.id
GROUP BY u.id;

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- API routes use the service-role client (bypasses RLS).
-- Enabling RLS as a safety default; service role always bypasses it.

ALTER TABLE cash_sheet_uploads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_sheet_transactions  ENABLE ROW LEVEL SECURITY;

-- ── Verify ───────────────────────────────────────────────────────────────────

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('cash_sheet_uploads', 'cash_sheet_transactions');
