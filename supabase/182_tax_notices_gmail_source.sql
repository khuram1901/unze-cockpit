-- 182_tax_notices_gmail_source.sql
-- Track auto-imported tax notices from Gmail
-- Apply via Supabase SQL Editor

ALTER TABLE legal_notices
  ADD COLUMN IF NOT EXISTS source               text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS source_gmail_msg_id  text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS source_notes         text DEFAULT NULL;

-- Unique index to prevent duplicate imports of the same Gmail message
CREATE UNIQUE INDEX IF NOT EXISTS legal_notices_gmail_msg_id_unique
  ON legal_notices (source_gmail_msg_id)
  WHERE source_gmail_msg_id IS NOT NULL;

COMMENT ON COLUMN legal_notices.source IS 'e.g. ''gmail_auto'' for auto-imported notices';
COMMENT ON COLUMN legal_notices.source_gmail_msg_id IS 'Gmail message ID — prevents duplicate imports';
COMMENT ON COLUMN legal_notices.source_notes IS 'Raw extracted data: NTN, tax year, commissioner, etc.';
