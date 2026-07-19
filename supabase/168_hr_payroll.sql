-- 168_hr_payroll.sql
-- HR Payroll: monthly run tracker, exceptions, and FlowHCM import employee records.
-- Apply via Supabase SQL Editor.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Payroll runs — one row per company per calendar month.
--    payroll_month stored as the first day of the month (e.g. 2026-07-01).
--    status: 'Pending' → 'Processing' → 'Paid'
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_payroll_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  payroll_month    date NOT NULL,          -- first day of month
  total_gross      numeric(14,2),
  total_deductions numeric(14,2),
  total_net        numeric(14,2),
  headcount        integer,
  status           text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Processing','Paid')),
  processed_date   date,
  paid_date        date,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, payroll_month)
);

ALTER TABLE hr_payroll_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read" ON hr_payroll_runs;
DROP POLICY IF EXISTS "admin write"        ON hr_payroll_runs;

CREATE POLICY "authenticated read" ON hr_payroll_runs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin write" ON hr_payroll_runs
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM members WHERE members.email = auth.jwt() ->> 'email' AND members.role IN ('Admin','CEO','Manager'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM members WHERE members.email = auth.jwt() ->> 'email' AND members.role IN ('Admin','CEO','Manager'))
  );

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_hr_payroll_runs_updated_at') THEN
    CREATE TRIGGER set_hr_payroll_runs_updated_at
      BEFORE UPDATE ON hr_payroll_runs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Payroll exceptions — issues logged against a run.
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_payroll_exceptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         uuid REFERENCES hr_payroll_runs(id) ON DELETE CASCADE,
  company_id     uuid REFERENCES companies(id) ON DELETE SET NULL,
  exception_type text NOT NULL,    -- 'Missing bank detail', 'Overtime not approved', etc.
  employee_name  text,
  description    text,
  status         text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Resolved')),
  resolved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hr_payroll_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read" ON hr_payroll_exceptions;
DROP POLICY IF EXISTS "admin write"        ON hr_payroll_exceptions;

CREATE POLICY "authenticated read" ON hr_payroll_exceptions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin write" ON hr_payroll_exceptions
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM members WHERE members.email = auth.jwt() ->> 'email' AND members.role IN ('Admin','CEO','Manager'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM members WHERE members.email = auth.jwt() ->> 'email' AND members.role IN ('Admin','CEO','Manager'))
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Payroll employees — imported from FlowHCM CSV/Excel per run.
--    One row per employee per run.
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_payroll_employees (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         uuid NOT NULL REFERENCES hr_payroll_runs(id) ON DELETE CASCADE,
  employee_id    text,
  employee_name  text NOT NULL,
  department     text,
  designation    text,
  basic_salary   numeric(14,2),
  allowances     numeric(14,2),
  deductions     numeric(14,2),
  net_pay        numeric(14,2),
  bank_account   text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hr_payroll_employees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read" ON hr_payroll_employees;
DROP POLICY IF EXISTS "admin write"        ON hr_payroll_employees;

CREATE POLICY "authenticated read" ON hr_payroll_employees
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin write" ON hr_payroll_employees
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM members WHERE members.email = auth.jwt() ->> 'email' AND members.role IN ('Admin','CEO','Manager'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM members WHERE members.email = auth.jwt() ->> 'email' AND members.role IN ('Admin','CEO','Manager'))
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 4. RPC: get_payroll_dashboard
--    Returns last 6 months of runs with exception counts — one DB round-trip.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_payroll_dashboard()
RETURNS TABLE (
  run_id           uuid,
  company_id       uuid,
  company_name     text,
  payroll_month    date,
  total_gross      numeric,
  total_net        numeric,
  headcount        integer,
  status           text,
  paid_date        date,
  open_exceptions  bigint,
  employee_count   bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id                                                                          AS run_id,
    r.company_id,
    c.name                                                                        AS company_name,
    r.payroll_month,
    r.total_gross,
    r.total_net,
    r.headcount,
    r.status,
    r.paid_date,
    (SELECT COUNT(*) FROM hr_payroll_exceptions e WHERE e.run_id = r.id AND e.status = 'Open')  AS open_exceptions,
    (SELECT COUNT(*) FROM hr_payroll_employees  emp WHERE emp.run_id = r.id)                    AS employee_count
  FROM hr_payroll_runs r
  JOIN companies c ON c.id = r.company_id
  WHERE r.payroll_month >= date_trunc('month', now()) - interval '5 months'
  ORDER BY r.payroll_month DESC, c.name;
$$;

REVOKE ALL ON FUNCTION get_payroll_dashboard() FROM anon;
GRANT EXECUTE ON FUNCTION get_payroll_dashboard() TO authenticated;
