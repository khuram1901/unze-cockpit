-- Add company_id to department_budgets and update unique constraint
ALTER TABLE department_budgets ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);

-- Drop old constraint and create new one with company_id
ALTER TABLE department_budgets DROP CONSTRAINT IF EXISTS dept_budget_unique;
ALTER TABLE department_budgets ADD CONSTRAINT dept_budget_unique UNIQUE (company_id, department, budget_month, category);

-- Update RLS: allow Finance managers to read and insert
DROP POLICY IF EXISTS "budget_read" ON department_budgets;
DROP POLICY IF EXISTS "budget_write" ON department_budgets;
CREATE POLICY "budget_select" ON department_budgets FOR SELECT USING (true);
CREATE POLICY "budget_insert" ON department_budgets FOR INSERT WITH CHECK (true);
CREATE POLICY "budget_update" ON department_budgets FOR UPDATE USING (true);
CREATE POLICY "budget_delete" ON department_budgets FOR DELETE USING (is_admin_or_exec());
