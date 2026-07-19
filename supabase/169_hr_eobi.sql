-- 169_hr_eobi.sql
-- EOBI & Social Security: registrations, EOBI monthly payments, ESSI monthly payments.
-- Apply via Supabase SQL Editor.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Registrations — one row per company per scheme (EOBI / ESSI / PESSI etc.)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_eobi_registrations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  scheme           text NOT NULL CHECK (scheme IN ('EOBI','ESSI','PESSI','Other')),
  registration_no  text NOT NULL,
  registered_date  date,
  renewal_due_date date,
  is_active        boolean NOT NULL DEFAULT true,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, scheme)
);

ALTER TABLE hr_eobi_registrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read" ON hr_eobi_registrations;
DROP POLICY IF EXISTS "admin write"        ON hr_eobi_registrations;
CREATE POLICY "authenticated read" ON hr_eobi_registrations FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write"        ON hr_eobi_registrations FOR ALL    TO authenticated
  USING      (EXISTS (SELECT 1 FROM members WHERE members.email = auth.jwt() ->> 'email' AND members.role IN ('Admin','CEO','Manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM members WHERE members.email = auth.jwt() ->> 'email' AND members.role IN ('Admin','CEO','Manager')));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_hr_eobi_registrations_updated_at') THEN
    CREATE TRIGGER set_hr_eobi_registrations_updated_at
      BEFORE UPDATE ON hr_eobi_registrations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. EOBI monthly payments
--    contribution_month: first day of the month (e.g. 2026-07-01)
--    enrolled_count: number of employees enrolled this month
--    amount: total EOBI contribution (employer + employee share)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_eobi_payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contribution_month  date NOT NULL,
  enrolled_count      integer,
  amount              numeric(14,2) NOT NULL,
  due_date            date,
  paid_date           date,
  challan_no          text,
  status              text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Paid','Late')),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, contribution_month)
);

ALTER TABLE hr_eobi_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read" ON hr_eobi_payments;
DROP POLICY IF EXISTS "admin write"        ON hr_eobi_payments;
CREATE POLICY "authenticated read" ON hr_eobi_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write"        ON hr_eobi_payments FOR ALL    TO authenticated
  USING      (EXISTS (SELECT 1 FROM members WHERE members.email = auth.jwt() ->> 'email' AND members.role IN ('Admin','CEO','Manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM members WHERE members.email = auth.jwt() ->> 'email' AND members.role IN ('Admin','CEO','Manager')));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_hr_eobi_payments_updated_at') THEN
    CREATE TRIGGER set_hr_eobi_payments_updated_at
      BEFORE UPDATE ON hr_eobi_payments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. ESSI monthly payments (Employees' Social Security Institution)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_essi_payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contribution_month  date NOT NULL,
  enrolled_count      integer,
  amount              numeric(14,2) NOT NULL,
  due_date            date,
  paid_date           date,
  challan_no          text,
  status              text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Paid','Late')),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, contribution_month)
);

ALTER TABLE hr_essi_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read" ON hr_essi_payments;
DROP POLICY IF EXISTS "admin write"        ON hr_essi_payments;
CREATE POLICY "authenticated read" ON hr_essi_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write"        ON hr_essi_payments FOR ALL    TO authenticated
  USING      (EXISTS (SELECT 1 FROM members WHERE members.email = auth.jwt() ->> 'email' AND members.role IN ('Admin','CEO','Manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM members WHERE members.email = auth.jwt() ->> 'email' AND members.role IN ('Admin','CEO','Manager')));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_hr_essi_payments_updated_at') THEN
    CREATE TRIGGER set_hr_essi_payments_updated_at
      BEFORE UPDATE ON hr_essi_payments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. RPC: get_eobi_dashboard — all KPI data in one round-trip
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_eobi_dashboard()
RETURNS TABLE (
  total_enrolled_eobi   bigint,
  total_enrolled_essi   bigint,
  eobi_pending_count    bigint,
  essi_pending_count    bigint,
  eobi_overdue_count    bigint,
  essi_overdue_count    bigint,
  registrations_expiring bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COALESCE(SUM(enrolled_count),0) FROM hr_eobi_payments
       WHERE contribution_month = date_trunc('month', now()))               AS total_enrolled_eobi,
    (SELECT COALESCE(SUM(enrolled_count),0) FROM hr_essi_payments
       WHERE contribution_month = date_trunc('month', now()))               AS total_enrolled_essi,
    (SELECT COUNT(*) FROM hr_eobi_payments WHERE status = 'Pending')        AS eobi_pending_count,
    (SELECT COUNT(*) FROM hr_essi_payments WHERE status = 'Pending')        AS essi_pending_count,
    (SELECT COUNT(*) FROM hr_eobi_payments
       WHERE status = 'Pending' AND due_date < CURRENT_DATE)                AS eobi_overdue_count,
    (SELECT COUNT(*) FROM hr_essi_payments
       WHERE status = 'Pending' AND due_date < CURRENT_DATE)                AS essi_overdue_count,
    (SELECT COUNT(*) FROM hr_eobi_registrations
       WHERE is_active = true
         AND renewal_due_date IS NOT NULL
         AND renewal_due_date <= CURRENT_DATE + interval '60 days')         AS registrations_expiring;
$$;

REVOKE ALL ON FUNCTION get_eobi_dashboard() FROM anon;
GRANT EXECUTE ON FUNCTION get_eobi_dashboard() TO authenticated;
