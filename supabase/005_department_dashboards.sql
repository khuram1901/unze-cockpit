-- Sprint E1: Department dashboard tables
-- Run this in the Supabase SQL Editor

-- Audit
CREATE TABLE IF NOT EXISTS audit_plan_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid REFERENCES companies(id) NOT NULL,
  audit_area text NOT NULL,
  audit_type text,
  scope text,
  planned_date date,
  status text DEFAULT 'Planned',
  findings_count int DEFAULT 0,
  assigned_to text,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_findings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid REFERENCES companies(id) NOT NULL,
  plan_item_id uuid REFERENCES audit_plan_items(id),
  severity text DEFAULT 'Medium',
  risk_impact text,
  description text NOT NULL,
  owner text,
  due_date date,
  evidence_url text,
  status text DEFAULT 'Open',
  created_at timestamptz DEFAULT now()
);

-- HR
CREATE TABLE IF NOT EXISTS recruitment_positions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid REFERENCES companies(id) NOT NULL,
  position_title text NOT NULL,
  department text,
  status text DEFAULT 'Open',
  date_opened date,
  date_filled date,
  time_to_hire_days int,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS performance_evaluations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid REFERENCES companies(id) NOT NULL,
  employee_name text NOT NULL,
  department text,
  evaluation_period text,
  rating text,
  status text DEFAULT 'Pending',
  completed_date date,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hr_strategy_goals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid REFERENCES companies(id) NOT NULL,
  goal_title text NOT NULL,
  target_date date,
  progress_pct int DEFAULT 0,
  status text DEFAULT 'Not Started',
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Legal & Tax
CREATE TABLE IF NOT EXISTS legal_notices (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid REFERENCES companies(id) NOT NULL,
  notice_type text DEFAULT 'legal',
  title text NOT NULL,
  company_name text,
  received_date date,
  consultant_name text,
  our_action_required text,
  consultant_action_required text,
  hearing_deadline date,
  financial_exposure numeric DEFAULT 0,
  exposure_currency text DEFAULT 'PKR',
  resolution_status text DEFAULT 'pending',
  last_update_date date,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Admin
CREATE TABLE IF NOT EXISTS admin_categories (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid REFERENCES companies(id) NOT NULL,
  category_name text NOT NULL,
  monthly_budget numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(company_id, category_name)
);

CREATE TABLE IF NOT EXISTS admin_spend (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid REFERENCES companies(id) NOT NULL,
  category_id uuid REFERENCES admin_categories(id),
  spend_month text NOT NULL,
  amount numeric DEFAULT 0,
  description text,
  created_at timestamptz DEFAULT now()
);
