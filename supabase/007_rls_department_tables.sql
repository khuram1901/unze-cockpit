-- Fix RLS for department dashboard tables
-- Run this in the Supabase SQL Editor

-- Enable RLS and add permissive policies for authenticated users

-- Audit tables
ALTER TABLE audit_plan_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON audit_plan_items FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE audit_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON audit_findings FOR ALL USING (true) WITH CHECK (true);

-- HR tables
ALTER TABLE recruitment_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON recruitment_positions FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE performance_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON performance_evaluations FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE hr_strategy_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON hr_strategy_goals FOR ALL USING (true) WITH CHECK (true);

-- Taxation (legal_notices)
ALTER TABLE legal_notices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON legal_notices FOR ALL USING (true) WITH CHECK (true);

-- Admin tables
ALTER TABLE admin_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON admin_categories FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE admin_spend ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON admin_spend FOR ALL USING (true) WITH CHECK (true);

-- Meetings tables
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON meetings FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE meeting_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON meeting_tasks FOR ALL USING (true) WITH CHECK (true);

-- Monthly budgets and forecasts
ALTER TABLE monthly_budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON monthly_budgets FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE quarterly_forecasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON quarterly_forecasts FOR ALL USING (true) WITH CHECK (true);

-- Google OAuth tokens (read access for connection status check)
ALTER TABLE google_oauth_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON google_oauth_tokens FOR ALL USING (true) WITH CHECK (true);

-- Bank position snapshots
ALTER TABLE bank_position_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON bank_position_snapshots FOR ALL USING (true) WITH CHECK (true);

-- Companies
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON companies FOR ALL USING (true) WITH CHECK (true);
