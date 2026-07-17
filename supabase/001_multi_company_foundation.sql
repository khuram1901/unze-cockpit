-- ============================================================
-- Sprint 1.2: Multi-company foundation
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- 1. Create companies table
CREATE TABLE IF NOT EXISTS companies (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  short_code text UNIQUE,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 2. Seed Unze Trading Pvt Ltd
INSERT INTO companies (name, short_code)
VALUES ('Unze Trading Pvt Ltd', 'UTPL')
ON CONFLICT (short_code) DO NOTHING;

-- 3. Add company_id to existing finance tables
ALTER TABLE daily_cash_position
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);

ALTER TABLE monthly_cash_plan
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);

ALTER TABLE cash_opening_balance
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);

-- 4. Backfill existing rows with UTPL company id
UPDATE daily_cash_position
  SET company_id = (SELECT id FROM companies WHERE short_code = 'UTPL')
  WHERE company_id IS NULL;

UPDATE monthly_cash_plan
  SET company_id = (SELECT id FROM companies WHERE short_code = 'UTPL')
  WHERE company_id IS NULL;

UPDATE cash_opening_balance
  SET company_id = (SELECT id FROM companies WHERE short_code = 'UTPL')
  WHERE company_id IS NULL;

-- 5. Add raw_pdf_filename, uploaded_by, reconciled to daily_cash_position
ALTER TABLE daily_cash_position
  ADD COLUMN IF NOT EXISTS raw_pdf_filename text,
  ADD COLUMN IF NOT EXISTS uploaded_by text,
  ADD COLUMN IF NOT EXISTS reconciled boolean DEFAULT false;

-- 6. Create bank_position_snapshots table
CREATE TABLE IF NOT EXISTS bank_position_snapshots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid REFERENCES companies(id) NOT NULL,
  position_date date NOT NULL,
  cash_at_office numeric DEFAULT 0,
  js_bank_unze_trading numeric DEFAULT 0,
  askari_bank_saving numeric DEFAULT 0,
  allied_bank_unze_trading numeric DEFAULT 0,
  dib_bank numeric DEFAULT 0,
  silk_bank_saving numeric DEFAULT 0,
  mcb_unze_trading numeric DEFAULT 0,
  askari_saving_1489 numeric DEFAULT 0,
  askari_saving_unze_trading numeric DEFAULT 0,
  hbl_pf_unze_trading numeric DEFAULT 0,
  meezan_bank_unze_trading numeric DEFAULT 0,
  hbl_unze_trading numeric DEFAULT 0,
  hbl_h_unze_trading numeric DEFAULT 0,
  faysal_bank_unze_trading numeric DEFAULT 0,
  total_available_balance numeric DEFAULT 0,
  post_dated_cheques_total numeric DEFAULT 0,
  post_dated_currency text DEFAULT 'PKR',
  raw_pdf_filename text,
  uploaded_by text,
  reconciled boolean DEFAULT false,
  reconcile_notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(company_id, position_date)
);

-- 7. Output the UTPL company id (copy this into your constants.ts)
SELECT id, name, short_code FROM companies WHERE short_code = 'UTPL';
