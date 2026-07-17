-- 070_tax_accounts_schedule.sql
-- Creates tables for the Tax Accounts Schedule feature.
-- Apply manually in Supabase SQL Editor.

-- TABLE 1: Quarterly accounts schedule step statuses
CREATE TABLE IF NOT EXISTS tax_schedule_entries (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_year     text        NOT NULL,
  section      text        NOT NULL CHECK (section IN ('Q1','Q2','Q3','Q4','Annual')),
  step_index   integer     NOT NULL CHECK (step_index BETWEEN 1 AND 6),
  entity_key   text        NOT NULL,
  status       text        NOT NULL DEFAULT 'Not Started'
                CHECK (status IN ('Not Started','In Progress','External Auditors','Completed')),
  updated_by   text,
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (tax_year, section, step_index, entity_key)
);

CREATE INDEX IF NOT EXISTS idx_tax_schedule_year ON tax_schedule_entries (tax_year);

-- TABLE 2: Monthly/quarterly return filing statuses
CREATE TABLE IF NOT EXISTS tax_return_filings (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_year     text        NOT NULL,
  return_type  text        NOT NULL
                CHECK (return_type IN ('FBR_SALES_TAX','PRA_TAX','INCOME_TAX')),
  entity_key   text        NOT NULL,
  period_key   text        NOT NULL,
  filed        boolean     NOT NULL DEFAULT false,
  filed_at     timestamptz,
  filed_by     text,
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (tax_year, return_type, entity_key, period_key)
);

CREATE INDEX IF NOT EXISTS idx_tax_return_year ON tax_return_filings (tax_year);

-- PERMISSION COLUMNS
-- NULL = not explicitly set.
-- canViewTaxAccounts() defaults to true when NULL (all authenticated users can view).
-- canManageTaxSchedule() defaults to false when NULL (manage granted explicitly below).
ALTER TABLE member_permissions
  ADD COLUMN IF NOT EXISTS can_view_dept_tax_accounts boolean DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS can_manage_tax_schedule    boolean DEFAULT NULL;

-- Grant manage access to named users only
UPDATE member_permissions mp
SET can_manage_tax_schedule = true
FROM members m
WHERE mp.member_id = m.id
AND (
  m.email = 'k.saleem@unzegroup.com'
  OR m.email = 'khuram1901@gmail.com'
  OR m.name ILIKE '%shakeel%'
  OR m.name ILIKE '%avess%'
  OR m.name ILIKE '%awais%'
);

-- RLS
ALTER TABLE tax_schedule_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tax_schedule_read"  ON tax_schedule_entries;
DROP POLICY IF EXISTS "tax_schedule_write" ON tax_schedule_entries;
CREATE POLICY "tax_schedule_read"  ON tax_schedule_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "tax_schedule_write" ON tax_schedule_entries FOR ALL    TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE tax_return_filings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tax_return_read"  ON tax_return_filings;
DROP POLICY IF EXISTS "tax_return_write" ON tax_return_filings;
CREATE POLICY "tax_return_read"  ON tax_return_filings FOR SELECT TO authenticated USING (true);
CREATE POLICY "tax_return_write" ON tax_return_filings FOR ALL    TO authenticated USING (true) WITH CHECK (true);
