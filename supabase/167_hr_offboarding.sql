-- 167_hr_offboarding.sql
-- HR Off-boarding: exit records with per-step checklist stored as JSONB.
-- Apply via Supabase SQL Editor.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Exit records
--    One row per departing employee.
--    checklist_state: { "resignation_received": true, "exit_interview_done": false, … }
--    exit_type: 'Resignation' | 'Termination' | 'Retirement' | 'Contract End' | 'Redundancy'
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_offboarding_exits (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid REFERENCES companies(id) ON DELETE SET NULL,
  member_email          text,                    -- links to members table (nullable — person may already be removed)
  member_name           text NOT NULL,
  department            text,
  exit_type             text NOT NULL CHECK (exit_type IN ('Resignation','Termination','Retirement','Contract End','Redundancy')),
  last_day              date NOT NULL,
  notice_period_days    integer,
  checklist_state       jsonb NOT NULL DEFAULT '{}',
  settlement_amount     numeric(14,2),
  settlement_due_date   date,
  settlement_paid_at    date,
  notes                 text,
  status                text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Completed','Cancelled')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hr_offboarding_exits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read" ON hr_offboarding_exits
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin write" ON hr_offboarding_exits
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM members
      WHERE members.email = auth.jwt() ->> 'email'
        AND members.role IN ('Admin', 'CEO', 'Manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM members
      WHERE members.email = auth.jwt() ->> 'email'
        AND members.role IN ('Admin', 'CEO', 'Manager')
    )
  );

-- updated_at trigger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_hr_offboarding_exits_updated_at'
  ) THEN
    CREATE TRIGGER set_hr_offboarding_exits_updated_at
      BEFORE UPDATE ON hr_offboarding_exits
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. RPC: get_offboarding_summary
--    Returns counts for the KPI cards — all aggregation in DB.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_offboarding_summary()
RETURNS TABLE (
  active_exits          bigint,
  completed_this_month  bigint,
  settlements_overdue   bigint,
  voluntary_ytd         bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*) FROM hr_offboarding_exits WHERE status = 'Active')                                                                   AS active_exits,
    (SELECT COUNT(*) FROM hr_offboarding_exits WHERE status = 'Completed'
       AND date_trunc('month', updated_at) = date_trunc('month', now()))                                                                  AS completed_this_month,
    (SELECT COUNT(*) FROM hr_offboarding_exits WHERE status = 'Active'
       AND settlement_due_date IS NOT NULL
       AND settlement_paid_at IS NULL
       AND settlement_due_date < CURRENT_DATE)                                                                                            AS settlements_overdue,
    (SELECT COUNT(*) FROM hr_offboarding_exits WHERE exit_type = 'Resignation'
       AND date_trunc('year', last_day) = date_trunc('year', now()))                                                                      AS voluntary_ytd;
$$;

REVOKE ALL ON FUNCTION get_offboarding_summary() FROM anon;
GRANT EXECUTE ON FUNCTION get_offboarding_summary() TO authenticated;
