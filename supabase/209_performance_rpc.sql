-- ─────────────────────────────────────────────────────────────────────────────
-- 209_performance_rpc.sql
-- RPC: get_performance_summary
--
-- Returns task-based performance data for the HR → Performance tab.
-- Scoring categories per task:
--   on_time         — Completed, completed_at::date ≤ due_date
--   late            — Completed, completed_at::date > due_date
--   employee_credit — Submitted (HOD hasn't responded; employee gets credit)
--   overdue         — In Progress / Not Started / Stuck / Waiting Reply,
--                     due_date < today
--   excluded        — Cancelled
--   running         — not yet due, still open
--
-- Two metrics returned per department / employee:
--   completion_pct  — (on_time + late + employee_credit) / total × 100
--   ontime_pct      — on_time / (on_time + late + employee_credit) × 100
--
-- APPLY MANUALLY via Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_performance_summary(
  p_days        integer DEFAULT 90,
  p_company_ids uuid[]  DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start_date date := CURRENT_DATE - p_days;
  v_result     json;
BEGIN

  WITH base AS (
    SELECT
      t.id,
      t.assigned_to            AS employee_email,
      t.assigned_by            AS manager_email,
      t.assigned_to_department AS department,
      t.company_id,
      t.status,
      t.due_date,
      -- Categorise task outcome
      CASE
        WHEN t.status = 'Cancelled'
          THEN 'excluded'
        WHEN t.status = 'Completed'
             AND t.completed_at IS NOT NULL
             AND t.completed_at::date <= t.due_date
          THEN 'on_time'
        WHEN t.status = 'Completed'
          THEN 'late'
        WHEN t.status = 'Submitted'
          THEN 'employee_credit'
        WHEN t.status IN ('In Progress', 'Not Started', 'Stuck', 'Waiting Reply')
             AND t.due_date < CURRENT_DATE
          THEN 'overdue'
        ELSE 'running'
      END AS perf_cat
    FROM tasks t
    WHERE
      t.assigned_date >= v_start_date
      AND t.assigned_to IS NOT NULL
      AND t.due_date    IS NOT NULL
      AND (p_company_ids IS NULL OR t.company_id = ANY(p_company_ids))
  ),

  -- ── Department level ───────────────────────────────────────────────────────
  dept_stats AS (
    SELECT
      b.department,
      b.company_id,
      COUNT(*) FILTER (WHERE b.perf_cat != 'excluded')                           AS total,
      COUNT(*) FILTER (WHERE b.perf_cat IN ('on_time','late','employee_credit'))  AS completed,
      COUNT(*) FILTER (WHERE b.perf_cat = 'on_time')                             AS on_time,
      COUNT(*) FILTER (WHERE b.perf_cat = 'late')                                AS late_count,
      COUNT(*) FILTER (WHERE b.perf_cat = 'overdue')                             AS overdue,
      COUNT(*) FILTER (WHERE b.perf_cat = 'employee_credit')                     AS employee_credit
    FROM base b
    WHERE b.department IS NOT NULL
    GROUP BY b.department, b.company_id
  ),

  -- ── Employee level (min 3 tasks to appear) ─────────────────────────────────
  emp_stats AS (
    SELECT
      b.employee_email,
      b.department,
      b.company_id,
      COUNT(*) FILTER (WHERE b.perf_cat != 'excluded')                           AS total,
      COUNT(*) FILTER (WHERE b.perf_cat IN ('on_time','late','employee_credit'))  AS completed,
      COUNT(*) FILTER (WHERE b.perf_cat = 'on_time')                             AS on_time,
      COUNT(*) FILTER (WHERE b.perf_cat = 'late')                                AS late_count,
      COUNT(*) FILTER (WHERE b.perf_cat = 'overdue')                             AS overdue,
      COUNT(*) FILTER (WHERE b.perf_cat = 'employee_credit')                     AS employee_credit
    FROM base b
    WHERE b.employee_email IS NOT NULL
    GROUP BY b.employee_email, b.department, b.company_id
    HAVING COUNT(*) FILTER (WHERE b.perf_cat != 'excluded') >= 3
  ),

  -- ── Manager level (tasks they assigned) ───────────────────────────────────
  mgr_stats AS (
    SELECT
      t.assigned_by  AS manager_email,
      COUNT(*) FILTER (WHERE t.status = 'Submitted')   AS pending_review,
      COUNT(*) FILTER (WHERE t.status = 'Completed')   AS tasks_completed,
      COUNT(*)                                          AS tasks_assigned
    FROM tasks t
    WHERE
      t.assigned_date >= v_start_date
      AND t.assigned_by IS NOT NULL
      AND (p_company_ids IS NULL OR t.company_id = ANY(p_company_ids))
    GROUP BY t.assigned_by
    HAVING
      COUNT(*) FILTER (WHERE t.status = 'Submitted') > 0
      OR COUNT(*) > 10
  )

  SELECT json_build_object(
    'period_days', p_days,

    -- ── Totals for KPI cards ────────────────────────────────────────────────
    'totals', (
      SELECT json_build_object(
        'total_assigned',   SUM(ds.total),
        'total_completed',  SUM(ds.completed),
        'total_on_time',    SUM(ds.on_time),
        'total_overdue',    SUM(ds.overdue),
        'total_submitted',  SUM(ds.employee_credit),
        'avg_completion_pct', CASE WHEN SUM(ds.total) > 0
          THEN ROUND(SUM(ds.completed)::numeric / SUM(ds.total) * 100)
          END,
        'avg_ontime_pct', CASE WHEN SUM(ds.completed) > 0
          THEN ROUND(SUM(ds.on_time)::numeric / SUM(ds.completed) * 100)
          END
      )
      FROM dept_stats ds
    ),

    -- ── Department breakdown ────────────────────────────────────────────────
    'departments', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'department',      d.department,
          'company_id',      d.company_id,
          'company_name',    c.name,
          'total',           d.total,
          'completed',       d.completed,
          'on_time',         d.on_time,
          'late',            d.late_count,
          'overdue',         d.overdue,
          'employee_credit', d.employee_credit,
          'completion_pct',  CASE WHEN d.total > 0
                               THEN ROUND(d.completed::numeric / d.total * 100)
                             END,
          'ontime_pct',      CASE WHEN d.completed > 0
                               THEN ROUND(d.on_time::numeric / d.completed * 100)
                             END
        )
        ORDER BY d.total DESC
      ), '[]'::json)
      FROM dept_stats d
      LEFT JOIN companies c ON c.id = d.company_id
    ),

    -- ── Employee breakdown ──────────────────────────────────────────────────
    'employees', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'email',           e.employee_email,
          'name',            COALESCE(m.name, e.employee_email),
          'department',      e.department,
          'company_id',      e.company_id,
          'company_name',    c.name,
          'total',           e.total,
          'completed',       e.completed,
          'on_time',         e.on_time,
          'late',            e.late_count,
          'overdue',         e.overdue,
          'employee_credit', e.employee_credit,
          'completion_pct',  CASE WHEN e.total > 0
                               THEN ROUND(e.completed::numeric / e.total * 100)
                             END,
          'ontime_pct',      CASE WHEN e.completed > 0
                               THEN ROUND(e.on_time::numeric / e.completed * 100)
                             END
        )
        ORDER BY e.on_time DESC, e.completed DESC, e.total DESC
      ), '[]'::json)
      FROM emp_stats e
      LEFT JOIN members m ON m.email = e.employee_email
      LEFT JOIN companies c ON c.id = e.company_id
    ),

    -- ── Manager review load ─────────────────────────────────────────────────
    'managers', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'email',           mg.manager_email,
          'name',            COALESCE(m.name, mg.manager_email),
          'pending_review',  mg.pending_review,
          'tasks_completed', mg.tasks_completed,
          'tasks_assigned',  mg.tasks_assigned
        )
        ORDER BY mg.pending_review DESC
      ), '[]'::json)
      FROM mgr_stats mg
      LEFT JOIN members m ON m.email = mg.manager_email
    )

  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Grant access to authenticated users (RLS on tasks enforces row visibility)
GRANT EXECUTE ON FUNCTION get_performance_summary(integer, uuid[]) TO authenticated;
