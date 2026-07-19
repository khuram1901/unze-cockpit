-- ============================================================
-- 176 — FlowHCM extended sync tables + analytics RPCs
-- Apply in: Supabase SQL Editor
-- ============================================================

-- ── Payroll (monthly, per employee) ──────────────────────────
CREATE TABLE IF NOT EXISTS flw_payroll_monthly (
  id                 bigserial   PRIMARY KEY,
  pay_month          date        NOT NULL,   -- first day of month, e.g. 2025-06-01
  employee_code      text        NOT NULL,
  employee_name      text,
  department         text,
  station            text,
  designation        text,
  basic_salary       numeric     DEFAULT 0,
  gross_salary       numeric     DEFAULT 0,
  net_salary         numeric     DEFAULT 0,
  total_deductions   numeric     DEFAULT 0,
  total_allowances   numeric     DEFAULT 0,
  status             text,       -- Processed | Draft | Cancelled
  synced_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pay_month, employee_code)
);
ALTER TABLE flw_payroll_monthly ENABLE ROW LEVEL SECURITY;

-- ── Performance / appraisal reviews ──────────────────────────
CREATE TABLE IF NOT EXISTS flw_performance_reviews (
  flw_id             text        PRIMARY KEY,
  employee_code      text,
  employee_name      text,
  department         text,
  station            text,
  review_period      text,       -- e.g. "2025-H1", "2025-Q2", "Annual 2025"
  review_type        text,       -- Annual | Mid-Year | Probation | Confirmation
  status             text,       -- Pending | Submitted | Approved | Overdue
  rating             numeric,    -- e.g. 3.5 out of 5
  due_date           date,
  completed_date     date,
  reviewer_name      text,
  reviewer_code      text,
  remarks            text,
  synced_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE flw_performance_reviews ENABLE ROW LEVEL SECURITY;

-- ── Training attendance records ───────────────────────────────
CREATE TABLE IF NOT EXISTS flw_training_records (
  flw_id             text        PRIMARY KEY,
  employee_code      text,
  employee_name      text,
  department         text,
  training_title     text,
  training_date      date,
  training_type      text,       -- Internal | External | Online
  status             text,       -- Attended | Absent | Pending
  score              numeric,    -- if assessed
  trainer            text,
  venue              text,
  synced_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE flw_training_records ENABLE ROW LEVEL SECURITY;

-- ── Disciplinary actions ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS flw_disciplinary (
  flw_id             text        PRIMARY KEY,
  employee_code      text,
  employee_name      text,
  department         text,
  station            text,
  notice_type        text,       -- Verbal Warning | Written Warning | Show Cause | Suspension | Termination
  issue_date         date,
  response_due_date  date,
  status             text,       -- Open | Closed | Appealed | Pending Response
  description        text,
  issued_by          text,
  synced_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE flw_disciplinary ENABLE ROW LEVEL SECURITY;

-- ── Employee loans ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flw_loans (
  flw_id             text        PRIMARY KEY,
  employee_code      text,
  employee_name      text,
  department         text,
  loan_type          text,       -- Personal | Emergency | Festival | Advance Salary
  principal_amount   numeric     DEFAULT 0,
  outstanding_amount numeric     DEFAULT 0,
  monthly_deduction  numeric     DEFAULT 0,
  start_date         date,
  expected_end_date  date,
  status             text,       -- Active | Completed | Cancelled
  synced_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE flw_loans ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ANALYTICS RPCs (all SECURITY DEFINER, all read-only)
-- ============================================================

-- ── 1. Recruitment funnel ─────────────────────────────────────
-- Works from existing recruitment_candidates + recruitment_positions
-- (already synced from FlowHCM via migration 174/sync route)
CREATE OR REPLACE FUNCTION get_flw_recruitment_funnel()
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT json_build_object(
    'open_positions',    (SELECT count(*) FROM recruitment_positions WHERE status = 'Open'),
    'filled_this_month', (
      SELECT count(*) FROM recruitment_positions
      WHERE status = 'Filled'
        AND date_closed >= date_trunc('month', CURRENT_DATE)
    ),
    'total_candidates',  (SELECT count(*) FROM recruitment_candidates),
    'by_stage', (
      SELECT json_agg(row_to_json(s))
      FROM (
        SELECT
          stage,
          count(*) AS count
        FROM recruitment_candidates
        GROUP BY stage
        ORDER BY
          CASE stage
            WHEN 'Applied'        THEN 1
            WHEN 'Screening'      THEN 2
            WHEN 'Shortlisted'    THEN 3
            WHEN 'Interviewed'    THEN 4
            WHEN 'Offer'          THEN 5
            WHEN 'Offer Accepted' THEN 6
            WHEN 'Hired'          THEN 7
            WHEN 'Rejected'       THEN 8
            ELSE 9
          END
      ) s
    ),
    'positions_by_status', (
      SELECT json_agg(row_to_json(p))
      FROM (
        SELECT status, count(*) AS count
        FROM recruitment_positions
        GROUP BY status ORDER BY count DESC
      ) p
    ),
    'long_open', (
      SELECT json_agg(row_to_json(lp))
      FROM (
        SELECT
          position_title,
          flw_company,
          (CURRENT_DATE - date_opened::date) AS days_open
        FROM recruitment_positions
        WHERE status = 'Open'
          AND date_opened IS NOT NULL
          AND (CURRENT_DATE - date_opened::date) > 45
        ORDER BY (CURRENT_DATE - date_opened::date) DESC
      ) lp
    ),
    'last_synced', (
      SELECT synced_at FROM flw_sync_log
      WHERE module = 'recruitment' AND status = 'success'
      ORDER BY synced_at DESC LIMIT 1
    )
  );
$$;

-- ── 2. Payroll summary by department (latest processed month) ─
CREATE OR REPLACE FUNCTION get_flw_payroll_dept_summary()
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  WITH latest_month AS (
    SELECT MAX(pay_month) AS month FROM flw_payroll_monthly WHERE status = 'Processed'
  )
  SELECT json_build_object(
    'month',        (SELECT month FROM latest_month),
    'total_gross',  (SELECT COALESCE(SUM(gross_salary), 0) FROM flw_payroll_monthly p JOIN latest_month lm ON p.pay_month = lm.month WHERE p.status = 'Processed'),
    'total_net',    (SELECT COALESCE(SUM(net_salary), 0)   FROM flw_payroll_monthly p JOIN latest_month lm ON p.pay_month = lm.month WHERE p.status = 'Processed'),
    'head_count',   (SELECT count(*)                        FROM flw_payroll_monthly p JOIN latest_month lm ON p.pay_month = lm.month WHERE p.status = 'Processed'),
    'by_department', (
      SELECT json_agg(row_to_json(d))
      FROM (
        SELECT
          p.department,
          count(*)                   AS headcount,
          ROUND(SUM(p.gross_salary)) AS gross_total,
          ROUND(SUM(p.net_salary))   AS net_total,
          ROUND(AVG(p.gross_salary)) AS avg_gross
        FROM flw_payroll_monthly p
        JOIN latest_month lm ON p.pay_month = lm.month
        WHERE p.status = 'Processed'
        GROUP BY p.department
        ORDER BY gross_total DESC
      ) d
    ),
    'last_synced', (
      SELECT synced_at FROM flw_sync_log
      WHERE module = 'payroll' AND status = 'success'
      ORDER BY synced_at DESC LIMIT 1
    )
  );
$$;

-- ── 3. Performance review summary ────────────────────────────
CREATE OR REPLACE FUNCTION get_flw_performance_summary()
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT json_build_object(
    'total',        (SELECT count(*) FROM flw_performance_reviews),
    'pending',      (SELECT count(*) FROM flw_performance_reviews WHERE status = 'Pending'),
    'overdue',      (SELECT count(*) FROM flw_performance_reviews WHERE status = 'Overdue' OR (status = 'Pending' AND due_date < CURRENT_DATE)),
    'completed',    (SELECT count(*) FROM flw_performance_reviews WHERE status IN ('Submitted', 'Approved')),
    'avg_rating',   (SELECT ROUND(AVG(rating)::numeric, 1) FROM flw_performance_reviews WHERE rating IS NOT NULL AND status IN ('Submitted', 'Approved')),
    'pending_list', (
      SELECT json_agg(json_build_object(
        'employee_name',  employee_name,
        'department',     department,
        'review_type',    review_type,
        'due_date',       due_date,
        'reviewer_name',  reviewer_name,
        'days_overdue',   GREATEST(0, (CURRENT_DATE - due_date))
      ) ORDER BY due_date ASC NULLS LAST)
      FROM flw_performance_reviews
      WHERE status IN ('Pending', 'Overdue')
        OR (status = 'Pending' AND due_date < CURRENT_DATE)
    ),
    'by_department', (
      SELECT json_agg(row_to_json(d))
      FROM (
        SELECT
          department,
          count(*) FILTER (WHERE status IN ('Submitted', 'Approved'))      AS completed,
          count(*) FILTER (WHERE status = 'Pending')                       AS pending,
          count(*) FILTER (WHERE status = 'Overdue' OR (status = 'Pending' AND due_date < CURRENT_DATE)) AS overdue,
          ROUND(AVG(rating) FILTER (WHERE rating IS NOT NULL)::numeric, 1) AS avg_rating
        FROM flw_performance_reviews
        GROUP BY department
        ORDER BY pending DESC
      ) d
    ),
    'last_synced', (
      SELECT synced_at FROM flw_sync_log
      WHERE module = 'performance' AND status = 'success'
      ORDER BY synced_at DESC LIMIT 1
    )
  );
$$;

-- ── 4. Training compliance by department ─────────────────────
CREATE OR REPLACE FUNCTION get_flw_training_compliance()
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT json_build_object(
    'total_records',   (SELECT count(*) FROM flw_training_records),
    'attended',        (SELECT count(*) FROM flw_training_records WHERE status = 'Attended'),
    'absent',          (SELECT count(*) FROM flw_training_records WHERE status = 'Absent'),
    'pending',         (SELECT count(*) FROM flw_training_records WHERE status = 'Pending'),
    'compliance_pct',  (
      SELECT CASE WHEN count(*) = 0 THEN 0
             ELSE ROUND(100.0 * count(*) FILTER (WHERE status = 'Attended') / count(*))
             END
      FROM flw_training_records
    ),
    'by_department', (
      SELECT json_agg(row_to_json(d))
      FROM (
        SELECT
          department,
          count(*)                                           AS total,
          count(*) FILTER (WHERE status = 'Attended')       AS attended,
          count(*) FILTER (WHERE status = 'Absent')         AS absent,
          ROUND(
            100.0 * count(*) FILTER (WHERE status = 'Attended') /
            NULLIF(count(*), 0)
          )                                                  AS compliance_pct
        FROM flw_training_records
        GROUP BY department
        ORDER BY compliance_pct DESC NULLS LAST
      ) d
    ),
    'recent_sessions', (
      SELECT json_agg(row_to_json(t))
      FROM (
        SELECT DISTINCT training_title, training_date, training_type,
          count(*) OVER (PARTITION BY training_title, training_date) AS attendees
        FROM flw_training_records
        WHERE training_date >= CURRENT_DATE - INTERVAL '90 days'
        ORDER BY training_date DESC
        LIMIT 8
      ) t
    ),
    'last_synced', (
      SELECT synced_at FROM flw_sync_log
      WHERE module = 'training_records' AND status = 'success'
      ORDER BY synced_at DESC LIMIT 1
    )
  );
$$;

-- ── 5. Open disciplinary cases ────────────────────────────────
CREATE OR REPLACE FUNCTION get_flw_disciplinary_open()
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT json_build_object(
    'open_count',       (SELECT count(*) FROM flw_disciplinary WHERE status IN ('Open', 'Pending Response')),
    'total_this_year',  (SELECT count(*) FROM flw_disciplinary WHERE EXTRACT(YEAR FROM issue_date) = EXTRACT(YEAR FROM CURRENT_DATE)),
    'by_type', (
      SELECT json_agg(row_to_json(t))
      FROM (
        SELECT notice_type, count(*) AS count
        FROM flw_disciplinary
        WHERE status IN ('Open', 'Pending Response')
        GROUP BY notice_type ORDER BY count DESC
      ) t
    ),
    'open_cases', (
      SELECT json_agg(json_build_object(
        'employee_name',     employee_name,
        'department',        department,
        'notice_type',       notice_type,
        'issue_date',        issue_date,
        'response_due_date', response_due_date,
        'status',            status
      ) ORDER BY issue_date DESC)
      FROM flw_disciplinary
      WHERE status IN ('Open', 'Pending Response')
    ),
    'last_synced', (
      SELECT synced_at FROM flw_sync_log
      WHERE module = 'disciplinary' AND status = 'success'
      ORDER BY synced_at DESC LIMIT 1
    )
  );
$$;

-- ── 6. Loans summary ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_flw_loans_summary()
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT json_build_object(
    'active_count',       (SELECT count(*)                         FROM flw_loans WHERE status = 'Active'),
    'total_outstanding',  (SELECT COALESCE(SUM(outstanding_amount), 0) FROM flw_loans WHERE status = 'Active'),
    'total_principal',    (SELECT COALESCE(SUM(principal_amount), 0)   FROM flw_loans WHERE status = 'Active'),
    'monthly_recovery',   (SELECT COALESCE(SUM(monthly_deduction), 0)  FROM flw_loans WHERE status = 'Active'),
    'by_type', (
      SELECT json_agg(row_to_json(t))
      FROM (
        SELECT loan_type,
          count(*)                         AS count,
          ROUND(SUM(outstanding_amount))   AS outstanding
        FROM flw_loans WHERE status = 'Active'
        GROUP BY loan_type ORDER BY outstanding DESC
      ) t
    ),
    'active_loans', (
      SELECT json_agg(json_build_object(
        'employee_name',    employee_name,
        'department',       department,
        'loan_type',        loan_type,
        'outstanding_amount', outstanding_amount,
        'monthly_deduction',  monthly_deduction,
        'expected_end_date',  expected_end_date
      ) ORDER BY outstanding_amount DESC)
      FROM flw_loans WHERE status = 'Active'
    ),
    'last_synced', (
      SELECT synced_at FROM flw_sync_log
      WHERE module = 'loans' AND status = 'success'
      ORDER BY synced_at DESC LIMIT 1
    )
  );
$$;
