-- ─────────────────────────────────────────────────────────────────────────────
-- 210_employee_detail_rpc.sql
-- RPC: get_employee_performance_detail
--
-- Returns a full performance profile for one employee:
--   summary      — overall KPIs for the period
--   weekly_trend — per-week counts for the bar chart
--   category_breakdown — on_time / late / overdue / submitted / running / excluded
--   tasks        — individual task list with perf category
--
-- APPLY MANUALLY via Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_employee_performance_detail(
  p_email  text,
  p_days   integer DEFAULT 90
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
      t.title,
      t.status,
      t.due_date,
      t.assigned_date,
      t.completed_at,
      t.assigned_to_department AS department,
      t.assigned_by            AS manager_email,
      t.company_id,
      -- Categorise
      CASE
        WHEN t.status = 'Cancelled' THEN 'excluded'
        WHEN t.status = 'Completed'
             AND t.completed_at IS NOT NULL
             AND t.completed_at::date <= t.due_date THEN 'on_time'
        WHEN t.status = 'Completed' THEN 'late'
        WHEN t.status = 'Submitted' THEN 'employee_credit'
        WHEN t.status IN ('In Progress','Not Started','Stuck','Waiting Reply')
             AND t.due_date < CURRENT_DATE THEN 'overdue'
        ELSE 'running'
      END AS perf_cat
    FROM tasks t
    WHERE
      t.assigned_to   = p_email
      AND t.assigned_date >= v_start_date
      AND t.due_date IS NOT NULL
  ),

  -- ── Summary KPIs ─────────────────────────────────────────────────────────
  summary_cte AS (
    SELECT
      COUNT(*) FILTER (WHERE perf_cat != 'excluded')                              AS total,
      COUNT(*) FILTER (WHERE perf_cat IN ('on_time','late','employee_credit'))    AS completed,
      COUNT(*) FILTER (WHERE perf_cat = 'on_time')                               AS on_time,
      COUNT(*) FILTER (WHERE perf_cat = 'late')                                  AS late,
      COUNT(*) FILTER (WHERE perf_cat = 'overdue')                               AS overdue,
      COUNT(*) FILTER (WHERE perf_cat = 'employee_credit')                       AS employee_credit,
      COUNT(*) FILTER (WHERE perf_cat = 'running')                               AS running,
      COUNT(*) FILTER (WHERE perf_cat = 'excluded')                              AS excluded,
      CASE WHEN COUNT(*) FILTER (WHERE perf_cat != 'excluded') > 0
        THEN ROUND(
          COUNT(*) FILTER (WHERE perf_cat IN ('on_time','late','employee_credit'))::numeric
          / COUNT(*) FILTER (WHERE perf_cat != 'excluded') * 100
        ) END AS completion_pct,
      CASE WHEN COUNT(*) FILTER (WHERE perf_cat IN ('on_time','late','employee_credit')) > 0
        THEN ROUND(
          COUNT(*) FILTER (WHERE perf_cat = 'on_time')::numeric
          / COUNT(*) FILTER (WHERE perf_cat IN ('on_time','late','employee_credit')) * 100
        ) END AS ontime_pct
    FROM base
  ),

  -- ── Weekly trend ─────────────────────────────────────────────────────────
  weekly_cte AS (
    SELECT
      date_trunc('week', assigned_date)::date                                     AS week_start,
      COUNT(*) FILTER (WHERE perf_cat != 'excluded')                              AS total,
      COUNT(*) FILTER (WHERE perf_cat IN ('on_time','late','employee_credit'))    AS completed,
      COUNT(*) FILTER (WHERE perf_cat = 'on_time')                               AS on_time,
      COUNT(*) FILTER (WHERE perf_cat = 'overdue')                               AS overdue,
      COUNT(*) FILTER (WHERE perf_cat = 'employee_credit')                       AS submitted
    FROM base
    GROUP BY date_trunc('week', assigned_date)::date
    ORDER BY week_start
  ),

  -- ── Category counts for donut / breakdown ────────────────────────────────
  category_cte AS (
    SELECT
      perf_cat,
      COUNT(*) AS cnt
    FROM base
    GROUP BY perf_cat
  )

  SELECT json_build_object(

    'email',       p_email,
    'period_days', p_days,

    -- Member info
    'name',        (SELECT COALESCE(m.name, p_email) FROM members m WHERE m.email = p_email LIMIT 1),
    'department',  (SELECT b.department FROM base b WHERE b.department IS NOT NULL LIMIT 1),

    -- ── Summary ──────────────────────────────────────────────────────────
    'summary', (
      SELECT row_to_json(s) FROM summary_cte s
    ),

    -- ── Weekly trend (array, oldest first) ───────────────────────────────
    'weekly_trend', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'week_start', w.week_start,
          'total',      w.total,
          'completed',  w.completed,
          'on_time',    w.on_time,
          'overdue',    w.overdue,
          'submitted',  w.submitted
        )
        ORDER BY w.week_start
      ), '[]'::json)
      FROM weekly_cte w
    ),

    -- ── Category breakdown ────────────────────────────────────────────────
    'categories', (
      SELECT COALESCE(json_object_agg(c.perf_cat, c.cnt), '{}'::json)
      FROM category_cte c
    ),

    -- ── Task list (most recent first, limit 100) ──────────────────────────
    'tasks', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'id',           b.id,
          'title',        b.title,
          'status',       b.status,
          'perf_cat',     b.perf_cat,
          'due_date',     b.due_date,
          'assigned_date',b.assigned_date,
          'completed_at', b.completed_at,
          'department',   b.department,
          'company_name', c.name
        )
        ORDER BY b.assigned_date DESC
      ), '[]'::json)
      FROM base b
      LEFT JOIN companies c ON c.id = b.company_id
      LIMIT 100
    )

  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_employee_performance_detail(text, integer) TO authenticated;
