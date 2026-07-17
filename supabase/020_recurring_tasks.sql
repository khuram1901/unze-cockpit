-- Recurring task templates
CREATE TABLE IF NOT EXISTS recurring_tasks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  description text NOT NULL,
  assigned_to text,
  assigned_to_email text,
  assigned_to_department text,
  assigned_by text,
  priority text DEFAULT 'Normal',
  project text,
  frequency text NOT NULL DEFAULT 'weekly',
  day_of_week integer,
  day_of_month integer,
  due_days_after integer DEFAULT 3,
  active boolean DEFAULT true,
  last_created_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE recurring_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recurring_read" ON recurring_tasks FOR SELECT USING (is_admin_or_exec());
CREATE POLICY "recurring_write" ON recurring_tasks FOR ALL USING (is_admin_or_exec()) WITH CHECK (is_admin_or_exec());
