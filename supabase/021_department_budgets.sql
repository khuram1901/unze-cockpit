-- Department budgets
CREATE TABLE IF NOT EXISTS department_budgets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  department text NOT NULL,
  budget_month text NOT NULL,
  category text NOT NULL,
  budgeted_amount numeric DEFAULT 0,
  actual_amount numeric DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE department_budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "budget_read" ON department_budgets FOR SELECT USING (is_admin_or_exec());
CREATE POLICY "budget_write" ON department_budgets FOR ALL USING (is_admin_or_exec()) WITH CHECK (is_admin_or_exec());

ALTER TABLE department_budgets ADD CONSTRAINT dept_budget_unique UNIQUE (department, budget_month, category);
CREATE INDEX IF NOT EXISTS idx_dept_budget_month ON department_budgets(department, budget_month);
