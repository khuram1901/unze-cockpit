-- Migration 040: Low priority schema fixes (items 58, 60, 61, 62)

-- ═══ ITEM 58: members.company → add company_id FK ═══
-- Add company_id UUID FK alongside existing text column (non-breaking)
ALTER TABLE members ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

-- Backfill company_id from text company field
UPDATE members SET company_id = '15884c2d-48a4-4d43-be90-0ef6e130790c'
  WHERE company ILIKE 'Unze Trading%' AND company_id IS NULL;
UPDATE members SET company_id = '77921705-8a15-4406-847a-b234f84b5ec3'
  WHERE company ILIKE 'Imperial%' AND company_id IS NULL;

-- Index for FK lookups
CREATE INDEX IF NOT EXISTS idx_members_company_id ON members(company_id);

-- ═══ ITEM 60: budget_month/plan_month text → add date column ═══
-- Add proper date columns alongside existing text fields (non-breaking)
ALTER TABLE monthly_budgets ADD COLUMN IF NOT EXISTS budget_date DATE;
ALTER TABLE monthly_cash_plan ADD COLUMN IF NOT EXISTS plan_date DATE;

-- Backfill: "2026-06" → '2026-06-01'
UPDATE monthly_budgets SET budget_date = (budget_month || '-01')::DATE
  WHERE budget_date IS NULL AND budget_month IS NOT NULL;
UPDATE monthly_cash_plan SET plan_date = (plan_month || '-01')::DATE
  WHERE plan_date IS NULL AND plan_month IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_budgets_budget_date ON monthly_budgets(budget_date);
CREATE INDEX IF NOT EXISTS idx_cash_plan_plan_date ON monthly_cash_plan(plan_date);

-- ═══ ITEM 61: Overlapping recurring_tasks RLS policies ═══
-- "recurring_read" (SELECT) is redundant — "recurring_write" (ALL) already covers SELECT
DROP POLICY IF EXISTS "recurring_read" ON recurring_tasks;

-- ═══ ITEM 62: Missing migration 026 placeholder ═══
-- No action needed in SQL — 026 was superseded by 027 (role model).
-- This file serves as the record that the gap was intentional.
