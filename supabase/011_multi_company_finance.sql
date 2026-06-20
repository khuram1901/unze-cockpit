-- ============================================================
-- Multi-company finance: add Imperial Footwear + fix constraints
-- Run this in the Supabase SQL Editor BEFORE deploying code
-- ============================================================

-- 1. Insert Imperial Footwear
INSERT INTO companies (name, short_code)
VALUES ('Imperial Footwear Pvt Ltd', 'IFPL')
ON CONFLICT (short_code) DO NOTHING;

-- 2. Add company field to members
ALTER TABLE members ADD COLUMN IF NOT EXISTS company text;

-- 3. Fix unique constraints for multi-company support

-- daily_cash_position: allow same date for different companies
ALTER TABLE daily_cash_position
  DROP CONSTRAINT IF EXISTS daily_cash_position_position_date_key;
ALTER TABLE daily_cash_position
  ADD CONSTRAINT daily_cash_position_company_date_uq UNIQUE (company_id, position_date);

-- monthly_cash_plan: allow same month for different companies
ALTER TABLE monthly_cash_plan
  DROP CONSTRAINT IF EXISTS monthly_cash_plan_plan_month_key;
ALTER TABLE monthly_cash_plan
  ADD CONSTRAINT monthly_cash_plan_company_month_uq UNIQUE (company_id, plan_month);

-- cash_opening_balance: prevent duplicate entries per company+date
ALTER TABLE cash_opening_balance
  ADD CONSTRAINT cash_opening_balance_company_date_uq UNIQUE (company_id, as_of_date);

-- 4. Output the Imperial Footwear company id (copy into constants.ts)
SELECT id, name, short_code FROM companies WHERE short_code = 'IFPL';
