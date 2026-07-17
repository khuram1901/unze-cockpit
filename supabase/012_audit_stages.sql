-- Add target_date, audit_stage, and completion_pct to audit_plan_items
ALTER TABLE audit_plan_items ADD COLUMN IF NOT EXISTS target_date date;
ALTER TABLE audit_plan_items ADD COLUMN IF NOT EXISTS audit_stage text DEFAULT 'Audit Planning';
ALTER TABLE audit_plan_items ADD COLUMN IF NOT EXISTS completion_pct integer DEFAULT 0;
