-- 172_hr_tasks.sql
-- HR Task management: general to-do list with employee/department links,
-- priority, due dates, and recurring tasks.
-- Apply via Supabase SQL Editor.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. HR Tasks
--    priority:    High | Medium | Low
--    status:      Open | In Progress | Done | Cancelled
--    recurrence:  NULL (one-off) | Monthly | Quarterly | Annually
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid REFERENCES companies(id) ON DELETE SET NULL,  -- NULL = applies to all companies
  title           text NOT NULL,
  description     text,
  assigned_to     text,             -- email of assignee (must be a member)
  department      text,             -- free-text department tag
  employee_name   text,             -- specific employee this task is about (optional)
  priority        text NOT NULL DEFAULT 'Medium' CHECK (priority IN ('High','Medium','Low')),
  status          text NOT NULL DEFAULT 'Open'   CHECK (status IN ('Open','In Progress','Done','Cancelled')),
  due_date        date,
  -- Recurring task support
  is_recurring    boolean NOT NULL DEFAULT false,
  recurrence      text CHECK (recurrence IN ('Monthly','Quarterly','Annually')),
  last_generated  date,             -- date the last recurrence instance was created
  parent_task_id  uuid REFERENCES hr_tasks(id) ON DELETE SET NULL,  -- for generated instances
  -- Audit
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hr_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read" ON hr_tasks;
DROP POLICY IF EXISTS "admin write"        ON hr_tasks;
CREATE POLICY "authenticated read" ON hr_tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write"        ON hr_tasks FOR ALL    TO authenticated
  USING      (EXISTS (SELECT 1 FROM members WHERE members.email = auth.jwt() ->> 'email' AND members.role IN ('Admin','CEO','Manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM members WHERE members.email = auth.jwt() ->> 'email' AND members.role IN ('Admin','CEO','Manager')));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_hr_tasks_updated_at') THEN
    CREATE TRIGGER set_hr_tasks_updated_at
      BEFORE UPDATE ON hr_tasks
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. RPC: get_hr_tasks_summary — KPI cards in one round-trip
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_hr_tasks_summary()
RETURNS TABLE (
  open_count          bigint,
  in_progress_count   bigint,
  overdue_count       bigint,
  due_today_count     bigint,
  completed_this_month bigint,
  high_priority_open  bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*) FROM hr_tasks WHERE status = 'Open')                           AS open_count,
    (SELECT COUNT(*) FROM hr_tasks WHERE status = 'In Progress')                    AS in_progress_count,
    (SELECT COUNT(*) FROM hr_tasks
       WHERE status IN ('Open','In Progress')
         AND due_date < CURRENT_DATE)                                               AS overdue_count,
    (SELECT COUNT(*) FROM hr_tasks
       WHERE status IN ('Open','In Progress')
         AND due_date = CURRENT_DATE)                                               AS due_today_count,
    (SELECT COUNT(*) FROM hr_tasks
       WHERE status = 'Done'
         AND date_trunc('month', updated_at) = date_trunc('month', now()))          AS completed_this_month,
    (SELECT COUNT(*) FROM hr_tasks
       WHERE status IN ('Open','In Progress')
         AND priority = 'High')                                                     AS high_priority_open;
$$;

REVOKE ALL ON FUNCTION get_hr_tasks_summary() FROM anon;
GRANT EXECUTE ON FUNCTION get_hr_tasks_summary() TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. RPC: generate_recurring_hr_tasks
--    Generates the next instance of each due recurring task.
--    Call via scheduled task (e.g. daily at 06:00).
--    Returns count of tasks generated.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_recurring_hr_tasks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec     hr_tasks%ROWTYPE;
  next_due date;
  generated integer := 0;
BEGIN
  FOR rec IN
    SELECT * FROM hr_tasks
    WHERE is_recurring = true
      AND recurrence IS NOT NULL
      AND status NOT IN ('Cancelled')
      AND parent_task_id IS NULL   -- only generate from master tasks, not instances
      AND (
        last_generated IS NULL
        OR (recurrence = 'Monthly'    AND last_generated < date_trunc('month', CURRENT_DATE))
        OR (recurrence = 'Quarterly'  AND last_generated < date_trunc('quarter', CURRENT_DATE))
        OR (recurrence = 'Annually'   AND last_generated < date_trunc('year', CURRENT_DATE))
      )
  LOOP
    -- Calculate the next due date from the original due_date day-of-month
    CASE rec.recurrence
      WHEN 'Monthly' THEN
        next_due := date_trunc('month', CURRENT_DATE)
                    + (EXTRACT(DAY FROM rec.due_date)::int - 1) * interval '1 day';
      WHEN 'Quarterly' THEN
        next_due := date_trunc('quarter', CURRENT_DATE)
                    + (EXTRACT(DAY FROM rec.due_date)::int - 1) * interval '1 day';
      WHEN 'Annually' THEN
        next_due := date_trunc('year', CURRENT_DATE)
                    + (EXTRACT(DOY FROM rec.due_date)::int - 1) * interval '1 day';
      ELSE
        next_due := CURRENT_DATE;
    END CASE;

    INSERT INTO hr_tasks (
      company_id, title, description, assigned_to, department, employee_name,
      priority, status, due_date, is_recurring, parent_task_id, created_by
    ) VALUES (
      rec.company_id, rec.title, rec.description, rec.assigned_to,
      rec.department, rec.employee_name, rec.priority, 'Open',
      next_due, false, rec.id, 'system (auto-generated)'
    )
    ON CONFLICT DO NOTHING;

    UPDATE hr_tasks SET last_generated = CURRENT_DATE WHERE id = rec.id;
    generated := generated + 1;
  END LOOP;

  RETURN generated;
END;
$$;

REVOKE ALL ON FUNCTION generate_recurring_hr_tasks() FROM anon;
GRANT EXECUTE ON FUNCTION generate_recurring_hr_tasks() TO authenticated;
