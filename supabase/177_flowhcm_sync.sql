-- ============================================================
-- 175 — FlowHCM 2-hourly sync tables + RPCs
-- Apply in: Supabase SQL Editor
-- ============================================================

-- ── Sync audit log ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flw_sync_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  synced_at     timestamptz NOT NULL DEFAULT now(),
  module        text        NOT NULL,
  records_synced integer    NOT NULL DEFAULT 0,
  status        text        NOT NULL DEFAULT 'success', -- success | error
  error_message text,
  duration_ms   integer
);

-- ── Employee master ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flw_employees (
  employee_code  text        PRIMARY KEY,
  full_name      text,
  designation    text,
  department     text,
  sub_department text,
  station        text,
  division       text,
  company        text,
  status         text,        -- Active | Inactive
  joining_date   date,
  cnic           text,
  email          text,
  mobile         text,
  grade          text,
  reports_to     text,
  synced_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Daily attendance ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flw_attendance_daily (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code   text        NOT NULL,
  employee_name   text,
  attendance_date date        NOT NULL,
  status          text,        -- Present | Absent | Late | HalfDay | EarlyLeave | OFF
  check_in        text,        -- stored as HH:MM string
  check_out       text,
  department      text,
  station         text,
  synced_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_code, attendance_date)
);

-- ── Leave requests ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flw_leave_requests (
  flw_id          text        PRIMARY KEY,  -- FlowHCM leave request ID
  employee_code   text,
  employee_name   text,
  leave_type      text,
  from_date       date,
  to_date         date,
  days            numeric,
  status          text,        -- Pending | Approved | Rejected
  department      text,
  station         text,
  synced_at       timestamptz NOT NULL DEFAULT now()
);

-- ── RLS: CEO/Manager/HR only ──────────────────────────────────
ALTER TABLE flw_sync_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE flw_employees        ENABLE ROW LEVEL SECURITY;
ALTER TABLE flw_attendance_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE flw_leave_requests   ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically — no policies needed for API routes
-- Frontend reads go through authedFetch → API routes → service client

-- ── RPC: workforce summary ────────────────────────────────────
CREATE OR REPLACE FUNCTION get_flw_workforce_summary()
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT json_build_object(
    'total_employees',   (SELECT count(*) FROM flw_employees WHERE status = 'Active'),
    'by_department',     (
      SELECT json_agg(row_to_json(d))
      FROM (
        SELECT department, count(*) AS headcount
        FROM flw_employees WHERE status = 'Active'
        GROUP BY department ORDER BY headcount DESC
      ) d
    ),
    'last_synced', (
      SELECT synced_at FROM flw_sync_log
      WHERE module = 'employees' AND status = 'success'
      ORDER BY synced_at DESC LIMIT 1
    )
  );
$$;

-- ── RPC: today's attendance summary ──────────────────────────
CREATE OR REPLACE FUNCTION get_flw_attendance_today()
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT json_build_object(
    'date',      CURRENT_DATE,
    'present',   (SELECT count(*) FROM flw_attendance_daily WHERE attendance_date = CURRENT_DATE AND status = 'Present'),
    'late',      (SELECT count(*) FROM flw_attendance_daily WHERE attendance_date = CURRENT_DATE AND status = 'Late'),
    'absent',    (SELECT count(*) FROM flw_attendance_daily WHERE attendance_date = CURRENT_DATE AND status = 'Absent'),
    'half_day',  (SELECT count(*) FROM flw_attendance_daily WHERE attendance_date = CURRENT_DATE AND status = 'HalfDay'),
    'absent_list', (
      SELECT json_agg(json_build_object(
        'employee_code', employee_code,
        'employee_name', employee_name,
        'department',    department,
        'station',       station
      ))
      FROM flw_attendance_daily
      WHERE attendance_date = CURRENT_DATE AND status = 'Absent'
    ),
    'late_list', (
      SELECT json_agg(json_build_object(
        'employee_code', employee_code,
        'employee_name', employee_name,
        'department',    department,
        'check_in',      check_in
      ))
      FROM flw_attendance_daily
      WHERE attendance_date = CURRENT_DATE AND status = 'Late'
    ),
    'last_synced', (
      SELECT synced_at FROM flw_sync_log
      WHERE module = 'attendance' AND status = 'success'
      ORDER BY synced_at DESC LIMIT 1
    )
  );
$$;

-- ── RPC: who is on leave today ────────────────────────────────
CREATE OR REPLACE FUNCTION get_flw_on_leave_today()
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT json_build_object(
    'date',  CURRENT_DATE,
    'count', (
      SELECT count(*) FROM flw_leave_requests
      WHERE status = 'Approved'
        AND from_date <= CURRENT_DATE
        AND to_date   >= CURRENT_DATE
    ),
    'employees', (
      SELECT json_agg(json_build_object(
        'employee_name', employee_name,
        'department',    department,
        'leave_type',    leave_type,
        'from_date',     from_date,
        'to_date',       to_date
      ) ORDER BY employee_name)
      FROM flw_leave_requests
      WHERE status = 'Approved'
        AND from_date <= CURRENT_DATE
        AND to_date   >= CURRENT_DATE
    ),
    'last_synced', (
      SELECT synced_at FROM flw_sync_log
      WHERE module = 'leave' AND status = 'success'
      ORDER BY synced_at DESC LIMIT 1
    )
  );
$$;

-- ── RPC: sync log summary (last 10 runs per module) ──────────
CREATE OR REPLACE FUNCTION get_flw_sync_status()
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT json_agg(row_to_json(s))
  FROM (
    SELECT DISTINCT ON (module)
      module, synced_at, status, records_synced, error_message, duration_ms
    FROM flw_sync_log
    ORDER BY module, synced_at DESC
  ) s;
$$;
