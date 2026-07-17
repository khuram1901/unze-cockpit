-- Sprint 4: Monthly budgets and quarterly forecasts
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS monthly_budgets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid REFERENCES companies(id) NOT NULL,
  budget_month text NOT NULL,
  flow_type text NOT NULL,
  category text NOT NULL,
  budgeted_amount numeric DEFAULT 0,
  uploaded_by text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(company_id, budget_month, category)
);

CREATE TABLE IF NOT EXISTS quarterly_forecasts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid REFERENCES companies(id) NOT NULL,
  forecast_quarter text NOT NULL,
  flow_type text NOT NULL,
  category text NOT NULL,
  forecast_amount numeric DEFAULT 0,
  uploaded_by text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(company_id, forecast_quarter, category)
);
