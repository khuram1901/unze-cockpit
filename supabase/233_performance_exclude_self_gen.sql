-- Migration 233: Exclude self-generated tasks from HR performance metrics
-- Self-gen tasks (assigned_to = assigned_by) skew scores for self-managing employees.
-- All aggregated metrics now use FILTER (WHERE NOT is_self_gen).
-- self_gen_count remains visible on screen for reference only.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. get_hr_performance_overview
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_hr_performance_overview(p_days integer DEFAULT 90)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
  v_cutoff date := CURRENT_DATE - (p_days || ' days')::interval;
  v_result jsonb;
BEGIN

  WITH

  task_base AS (
    SELECT
      t.id                                                                      AS task_id,
      t.description                                                             AS task_name,
      t.assigned_to_email                                                       AS emp_email,
      t.assigned_by_email                                                       AS assigner_email,
      t.due_date, t.status, t.stuck_reason,
      COALESCE(t.assigned_to_department, m.department)                          AS department,
      m.company                                                                  AS company,
      m.name                                                                     AS emp_name,
      m.employee_code                                                            AS employee_code,
      (t.assigned_to_email = t.assigned_by_email)                               AS is_self_gen,
      (t.status = 'Completed' AND t.completed_at::date <= t.due_date)           AS is_on_time,
      (t.status = 'Completed' AND t.completed_at::date >  t.due_date)           AS is_late,
      (t.status = 'Submitted')                                                   AS is_submitted,
      (t.status IN ('In Progress','Not Started')
        AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE)               AS is_overdue,
      (t.status IN ('Stuck','Waiting Reply'))                                    AS is_stuck
    FROM tasks t
    INNER JOIN members m ON m.email = t.assigned_to_email
    WHERE t.assigned_date  >= v_cutoff
      AND t.status         != 'Cancelled'
      AND m.is_active       = true
      AND m.name NOT ILIKE ANY(ARRAY[
            '%meeting minutes%','%recurring template%','%system%','%auto%'
          ])
  ),

  emp_agg AS (
    SELECT
      emp_email, emp_name, department, company, employee_code,
      COUNT(*)                                          FILTER (WHERE NOT is_self_gen) AS total_tasks,
      SUM(is_self_gen::int)                                                            AS self_gen_count,
      SUM(is_on_time::int)  FILTER (WHERE NOT is_self_gen)                            AS on_time_count,
      SUM(is_late::int)     FILTER (WHERE NOT is_self_gen)                            AS late_count,
      SUM(is_submitted::int)FILTER (WHERE NOT is_self_gen)                            AS submitted_count,
      SUM(is_overdue::int)  FILTER (WHERE NOT is_self_gen)                            AS overdue_count,
      SUM(is_stuck::int)    FILTER (WHERE NOT is_self_gen)                            AS stuck_count
    FROM task_base
    GROUP BY emp_email, emp_name, department, company, employee_code
  ),

  emp_scored AS (
    SELECT *,
      CASE WHEN total_tasks = 0 THEN 0 ELSE
        GREATEST(0, LEAST(100, ROUND(
          (on_time_count + late_count + submitted_count)::numeric / total_tasks * 50
          + on_time_count::numeric / total_tasks * 30
          - overdue_count::numeric / total_tasks * 20
        )))
      END AS efficiency_score
    FROM emp_agg
  ),

  emp_final AS (
    SELECT *,
      CASE
        WHEN efficiency_score >= 65 AND overdue_count = 0 THEN 'star'
        WHEN efficiency_score >= 55                        THEN 'on_track'
        WHEN efficiency_score >= 30                        THEN 'at_risk'
        ELSE                                                    'needs_help'
      END AS status
    FROM emp_scored
  ),

  dept_agg AS (
    SELECT
      department, company,
      COUNT(*)                                          FILTER (WHERE NOT is_self_gen) AS total_tasks,
      SUM(is_on_time::int)  FILTER (WHERE NOT is_self_gen)                            AS on_time_count,
      SUM(is_late::int)     FILTER (WHERE NOT is_self_gen)                            AS late_count,
      SUM(is_submitted::int)FILTER (WHERE NOT is_self_gen)                            AS submitted_count,
      SUM(is_overdue::int)  FILTER (WHERE NOT is_self_gen)                            AS overdue_count,
      SUM(is_stuck::int)    FILTER (WHERE NOT is_self_gen)                            AS stuck_count
    FROM task_base
    GROUP BY department, company
  ),

  dept_final AS (
    SELECT *,
      CASE WHEN total_tasks = 0 THEN 0 ELSE
        GREATEST(0, LEAST(100, ROUND(
          (on_time_count + late_count + submitted_count)::numeric / total_tasks * 50
          + on_time_count::numeric / total_tasks * 30
          - overdue_count::numeric / total_tasks * 20
        )))
      END AS efficiency_score,
      CASE
        WHEN CASE WHEN total_tasks = 0 THEN 0 ELSE GREATEST(0,LEAST(100,ROUND(
               (on_time_count+late_count+submitted_count)::numeric/total_tasks*50
               + on_time_count::numeric/total_tasks*30
               - overdue_count::numeric/total_tasks*20)))
             END >= 65
          AND overdue_count = 0 THEN 'star'
        WHEN CASE WHEN total_tasks = 0 THEN 0 ELSE GREATEST(0,LEAST(100,ROUND(
               (on_time_count+late_count+submitted_count)::numeric/total_tasks*50
               + on_time_count::numeric/total_tasks*30
               - overdue_count::numeric/total_tasks*20)))
             END >= 55 THEN 'on_track'
        WHEN CASE WHEN total_tasks = 0 THEN 0 ELSE GREATEST(0,LEAST(100,ROUND(
               (on_time_count+late_count+submitted_count)::numeric/total_tasks*50
               + on_time_count::numeric/total_tasks*30
               - overdue_count::numeric/total_tasks*20)))
             END >= 30 THEN 'at_risk'
        ELSE 'needs_help'
      END AS status
    FROM dept_agg
  ),

  co_agg AS (
    SELECT
      company,
      COUNT(*)                                          FILTER (WHERE NOT is_self_gen) AS total_tasks,
      SUM(is_on_time::int)  FILTER (WHERE NOT is_self_gen)                            AS on_time_count,
      SUM(is_late::int)     FILTER (WHERE NOT is_self_gen)                            AS late_count,
      SUM(is_submitted::int)FILTER (WHERE NOT is_self_gen)                            AS submitted_count,
      SUM(is_overdue::int)  FILTER (WHERE NOT is_self_gen)                            AS overdue_count,
      SUM(is_stuck::int)    FILTER (WHERE NOT is_self_gen)                            AS stuck_count
    FROM task_base
    GROUP BY company
  ),

  co_final AS (
    SELECT company, total_tasks, overdue_count, stuck_count, submitted_count,
      CASE WHEN total_tasks = 0 THEN 0 ELSE
        GREATEST(0, LEAST(100, ROUND(
          (on_time_count + late_count + submitted_count)::numeric / total_tasks * 50
          + on_time_count::numeric / total_tasks * 30
          - overdue_count::numeric / total_tasks * 20
        )))
      END AS efficiency_score
    FROM co_agg
  )

  SELECT jsonb_build_object(

    'period_days', p_days,

    'companies', (
      SELECT jsonb_agg(jsonb_build_object(
        'company',          c.company,
        'efficiency_score', c.efficiency_score,
        'total_tasks',      c.total_tasks,
        'overdue_count',    c.overdue_count,
        'stuck_count',      c.stuck_count,
        'submitted_count',  c.submitted_count
      ) ORDER BY c.efficiency_score DESC)
      FROM co_final c
    ),

    'kpis', (
      SELECT jsonb_build_object(
        'group_efficiency', GREATEST(0, LEAST(100, ROUND(
          (SUM(is_on_time::int) FILTER (WHERE NOT is_self_gen)
           + SUM(is_late::int) FILTER (WHERE NOT is_self_gen)
           + SUM(is_submitted::int) FILTER (WHERE NOT is_self_gen))::numeric
           / NULLIF(COUNT(*) FILTER (WHERE NOT is_self_gen), 0) * 50
          + SUM(is_on_time::int) FILTER (WHERE NOT is_self_gen)::numeric
           / NULLIF(COUNT(*) FILTER (WHERE NOT is_self_gen), 0) * 30
          - SUM(is_overdue::int) FILTER (WHERE NOT is_self_gen)::numeric
           / NULLIF(COUNT(*) FILTER (WHERE NOT is_self_gen), 0) * 20
        ))),
        'total_overdue',  SUM(is_overdue::int)   FILTER (WHERE NOT is_self_gen),
        'total_stuck',    SUM(is_stuck::int)      FILTER (WHERE NOT is_self_gen),
        'total_awaiting', SUM(is_submitted::int)  FILTER (WHERE NOT is_self_gen),
        'total_tasks',    COUNT(*)                FILTER (WHERE NOT is_self_gen)
      )
      FROM task_base
    ),

    'departments', (
      SELECT jsonb_agg(jsonb_build_object(
        'department',       d.department,
        'company',          d.company,
        'total_tasks',      d.total_tasks,
        'on_time_count',    d.on_time_count,
        'overdue_count',    d.overdue_count,
        'stuck_count',      d.stuck_count,
        'efficiency_score', d.efficiency_score,
        'status',           d.status
      ) ORDER BY d.efficiency_score DESC)
      FROM dept_final d
    ),

    'employees', (
      SELECT jsonb_agg(jsonb_build_object(
        'email',            e.emp_email,
        'name',             e.emp_name,
        'department',       e.department,
        'company',          e.company,
        'employee_code',    e.employee_code,
        'total_tasks',      e.total_tasks,
        'self_gen_count',   e.self_gen_count,
        'on_time_count',    e.on_time_count,
        'submitted_count',  e.submitted_count,
        'overdue_count',    e.overdue_count,
        'stuck_count',      e.stuck_count,
        'efficiency_score', e.efficiency_score,
        'status',           e.status
      ) ORDER BY e.efficiency_score DESC)
      FROM emp_final e
    )

  ) INTO v_result;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$func$;

REVOKE EXECUTE ON FUNCTION public.get_hr_performance_overview(integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_hr_performance_overview(integer) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. get_hr_company_performance
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_hr_company_performance(p_company text, p_days integer DEFAULT 90)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
  v_cutoff date := CURRENT_DATE - (p_days || ' days')::interval;
  v_result jsonb;
BEGIN

  WITH

  all_task_base AS (
    SELECT
      m.company                                                                  AS company,
      (t.assigned_to_email = t.assigned_by_email)                               AS is_self_gen,
      (t.status = 'Completed' AND t.completed_at::date <= t.due_date)           AS is_on_time,
      (t.status = 'Completed' AND t.completed_at::date >  t.due_date)           AS is_late,
      (t.status = 'Submitted')                                                   AS is_submitted,
      (t.status IN ('In Progress','Not Started')
        AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE)               AS is_overdue,
      (t.status IN ('Stuck','Waiting Reply'))                                    AS is_stuck
    FROM tasks t
    INNER JOIN members m ON m.email = t.assigned_to_email
    WHERE t.assigned_date  >= v_cutoff
      AND t.status         != 'Cancelled'
      AND m.is_active       = true
      AND m.name NOT ILIKE ANY(ARRAY[
            '%meeting minutes%','%recurring template%','%system%','%auto%'
          ])
  ),

  all_co_scored AS (
    SELECT
      company,
      COUNT(*)                                          FILTER (WHERE NOT is_self_gen) AS total_tasks,
      SUM(is_overdue::int)  FILTER (WHERE NOT is_self_gen)                            AS overdue_count,
      SUM(is_stuck::int)    FILTER (WHERE NOT is_self_gen)                            AS stuck_count,
      SUM(is_submitted::int)FILTER (WHERE NOT is_self_gen)                            AS submitted_count,
      CASE WHEN COUNT(*) FILTER (WHERE NOT is_self_gen) = 0 THEN 0 ELSE
        GREATEST(0, LEAST(100, ROUND(
          (SUM(is_on_time::int)   FILTER (WHERE NOT is_self_gen)
           + SUM(is_late::int)    FILTER (WHERE NOT is_self_gen)
           + SUM(is_submitted::int) FILTER (WHERE NOT is_self_gen))::numeric
           / COUNT(*) FILTER (WHERE NOT is_self_gen) * 50
          + SUM(is_on_time::int)  FILTER (WHERE NOT is_self_gen)::numeric
           / COUNT(*) FILTER (WHERE NOT is_self_gen) * 30
          - SUM(is_overdue::int)  FILTER (WHERE NOT is_self_gen)::numeric
           / COUNT(*) FILTER (WHERE NOT is_self_gen) * 20
        )))
      END AS efficiency_score
    FROM all_task_base
    GROUP BY company
  ),

  task_base AS (
    SELECT
      t.id                                                                      AS task_id,
      t.description                                                             AS task_name,
      t.assigned_to_email                                                       AS emp_email,
      t.due_date, t.status, t.stuck_reason,
      COALESCE(t.assigned_to_department, m.department)                          AS department,
      m.name                                                                     AS emp_name,
      m.employee_code                                                            AS employee_code,
      (t.assigned_to_email = t.assigned_by_email)                               AS is_self_gen,
      (t.status = 'Completed' AND t.completed_at::date <= t.due_date)           AS is_on_time,
      (t.status = 'Completed' AND t.completed_at::date >  t.due_date)           AS is_late,
      (t.status = 'Submitted')                                                   AS is_submitted,
      (t.status IN ('In Progress','Not Started')
        AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE)               AS is_overdue,
      (t.status IN ('Stuck','Waiting Reply'))                                    AS is_stuck
    FROM tasks t
    INNER JOIN members m ON m.email = t.assigned_to_email
    WHERE t.assigned_date  >= v_cutoff
      AND t.status         != 'Cancelled'
      AND m.company         = p_company
      AND m.is_active       = true
      AND m.name NOT ILIKE ANY(ARRAY[
            '%meeting minutes%','%recurring template%','%system%','%auto%'
          ])
  ),

  emp_agg AS (
    SELECT
      emp_email, emp_name, department, employee_code,
      COUNT(*)                                          FILTER (WHERE NOT is_self_gen) AS total_tasks,
      SUM(is_self_gen::int)                                                            AS self_gen_count,
      SUM(is_on_time::int)  FILTER (WHERE NOT is_self_gen)                            AS on_time_count,
      SUM(is_late::int)     FILTER (WHERE NOT is_self_gen)                            AS late_count,
      SUM(is_submitted::int)FILTER (WHERE NOT is_self_gen)                            AS submitted_count,
      SUM(is_overdue::int)  FILTER (WHERE NOT is_self_gen)                            AS overdue_count,
      SUM(is_stuck::int)    FILTER (WHERE NOT is_self_gen)                            AS stuck_count
    FROM task_base
    GROUP BY emp_email, emp_name, department, employee_code
  ),

  emp_final AS (
    SELECT *,
      CASE WHEN total_tasks = 0 THEN 0 ELSE
        GREATEST(0, LEAST(100, ROUND(
          (on_time_count + late_count + submitted_count)::numeric / total_tasks * 50
          + on_time_count::numeric / total_tasks * 30
          - overdue_count::numeric / total_tasks * 20
        )))
      END AS efficiency_score
    FROM emp_agg
  ),

  emp_with_status AS (
    SELECT *,
      CASE
        WHEN efficiency_score >= 65 AND overdue_count = 0 THEN 'star'
        WHEN efficiency_score >= 55                        THEN 'on_track'
        WHEN efficiency_score >= 30                        THEN 'at_risk'
        ELSE                                                    'needs_help'
      END AS status
    FROM emp_final
  ),

  dept_agg AS (
    SELECT
      department,
      COUNT(*)                                          FILTER (WHERE NOT is_self_gen) AS total_tasks,
      SUM(is_on_time::int)  FILTER (WHERE NOT is_self_gen)                            AS on_time_count,
      SUM(is_late::int)     FILTER (WHERE NOT is_self_gen)                            AS late_count,
      SUM(is_submitted::int)FILTER (WHERE NOT is_self_gen)                            AS submitted_count,
      SUM(is_overdue::int)  FILTER (WHERE NOT is_self_gen)                            AS overdue_count,
      SUM(is_stuck::int)    FILTER (WHERE NOT is_self_gen)                            AS stuck_count
    FROM task_base
    GROUP BY department
  ),

  dept_with_status AS (
    SELECT department, total_tasks, on_time_count, overdue_count, stuck_count,
      CASE WHEN total_tasks = 0 THEN 0 ELSE
        GREATEST(0, LEAST(100, ROUND(
          (on_time_count + late_count + submitted_count)::numeric / total_tasks * 50
          + on_time_count::numeric / total_tasks * 30
          - overdue_count::numeric / total_tasks * 20
        )))
      END AS efficiency_score
    FROM dept_agg
  )

  SELECT jsonb_build_object(

    'period_days', p_days,
    'company',     p_company,

    'all_companies', (
      SELECT jsonb_agg(jsonb_build_object(
        'company',          c.company,
        'efficiency_score', c.efficiency_score,
        'overdue_count',    c.overdue_count,
        'stuck_count',      c.stuck_count
      ) ORDER BY c.efficiency_score DESC)
      FROM all_co_scored c
    ),

    'kpis', (
      SELECT jsonb_build_object(
        'efficiency_score', (SELECT efficiency_score FROM all_co_scored WHERE company = p_company),
        'total_tasks',      COUNT(*)              FILTER (WHERE NOT is_self_gen),
        'total_overdue',    SUM(is_overdue::int)  FILTER (WHERE NOT is_self_gen),
        'total_stuck',      SUM(is_stuck::int)    FILTER (WHERE NOT is_self_gen),
        'total_awaiting',   SUM(is_submitted::int)FILTER (WHERE NOT is_self_gen),
        'total_employees',  COUNT(DISTINCT emp_email)
      )
      FROM task_base
    ),

    'departments', (
      SELECT jsonb_agg(jsonb_build_object(
        'department',       d.department,
        'total_tasks',      d.total_tasks,
        'on_time_count',    d.on_time_count,
        'overdue_count',    d.overdue_count,
        'stuck_count',      d.stuck_count,
        'efficiency_score', d.efficiency_score,
        'status', CASE
          WHEN d.efficiency_score >= 65 AND d.overdue_count = 0 THEN 'star'
          WHEN d.efficiency_score >= 55                          THEN 'on_track'
          WHEN d.efficiency_score >= 30                          THEN 'at_risk'
          ELSE                                                        'needs_help'
        END
      ) ORDER BY d.efficiency_score DESC)
      FROM dept_with_status d
    ),

    'employees', (
      SELECT jsonb_agg(jsonb_build_object(
        'email',            e.emp_email,
        'name',             e.emp_name,
        'department',       e.department,
        'employee_code',    e.employee_code,
        'total_tasks',      e.total_tasks,
        'self_gen_count',   e.self_gen_count,
        'on_time_count',    e.on_time_count,
        'submitted_count',  e.submitted_count,
        'overdue_count',    e.overdue_count,
        'stuck_count',      e.stuck_count,
        'efficiency_score', e.efficiency_score,
        'status',           e.status
      ) ORDER BY e.efficiency_score DESC)
      FROM emp_with_status e
    ),

    'stuck_tasks', (
      SELECT jsonb_agg(jsonb_build_object(
        'task_id',       tb.task_id,
        'task_name',     tb.task_name,
        'emp_email',     tb.emp_email,
        'emp_name',      tb.emp_name,
        'employee_code', tb.employee_code,
        'department',    tb.department,
        'status',        tb.status,
        'stuck_reason',  tb.stuck_reason,
        'due_date',      tb.due_date,
        'days_overdue',  (CURRENT_DATE - tb.due_date)
      ) ORDER BY tb.due_date ASC)
      FROM task_base tb
      WHERE tb.is_stuck = true
    )

  ) INTO v_result;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$func$;

REVOKE EXECUTE ON FUNCTION public.get_hr_company_performance(text, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_hr_company_performance(text, integer) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. get_hr_department_performance
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_hr_department_performance(p_department text, p_company text, p_days integer DEFAULT 90)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
  v_cutoff date := CURRENT_DATE - (p_days || ' days')::interval;
  v_result jsonb;
BEGIN

  WITH

  task_base AS (
    SELECT
      t.id                                                                      AS task_id,
      t.description                                                             AS task_name,
      t.assigned_to_email                                                       AS emp_email,
      t.due_date, t.status, t.stuck_reason,
      COALESCE(t.assigned_to_department, m.department)                          AS department,
      m.name                                                                     AS emp_name,
      m.employee_code                                                            AS employee_code,
      (t.assigned_to_email = t.assigned_by_email)                               AS is_self_gen,
      (t.status = 'Completed' AND t.completed_at::date <= t.due_date)           AS is_on_time,
      (t.status = 'Completed' AND t.completed_at::date >  t.due_date)           AS is_late,
      (t.status = 'Submitted')                                                   AS is_submitted,
      (t.status IN ('In Progress','Not Started')
        AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE)               AS is_overdue,
      (t.status IN ('Stuck','Waiting Reply'))                                    AS is_stuck,
      (t.status IN ('In Progress','Not Started')
        AND (t.due_date IS NULL OR t.due_date >= CURRENT_DATE))                 AS is_running
    FROM tasks t
    INNER JOIN members m ON m.email = t.assigned_to_email
    WHERE t.assigned_date  >= v_cutoff
      AND t.status         != 'Cancelled'
      AND m.company         = p_company
      AND COALESCE(t.assigned_to_department, m.department) = p_department
      AND m.is_active       = true
      AND m.name NOT ILIKE ANY(ARRAY[
            '%meeting minutes%','%recurring template%','%system%','%auto%'
          ])
  ),

  emp_agg AS (
    SELECT
      emp_email, emp_name, employee_code,
      COUNT(*)                                          FILTER (WHERE NOT is_self_gen) AS total_tasks,
      SUM(is_self_gen::int)                                                            AS self_gen_count,
      SUM(is_on_time::int)  FILTER (WHERE NOT is_self_gen)                            AS on_time_count,
      SUM(is_late::int)     FILTER (WHERE NOT is_self_gen)                            AS late_count,
      SUM(is_submitted::int)FILTER (WHERE NOT is_self_gen)                            AS submitted_count,
      SUM(is_overdue::int)  FILTER (WHERE NOT is_self_gen)                            AS overdue_count,
      SUM(is_stuck::int)    FILTER (WHERE NOT is_self_gen)                            AS stuck_count,
      SUM(is_running::int)  FILTER (WHERE NOT is_self_gen)                            AS running_count
    FROM task_base
    GROUP BY emp_email, emp_name, employee_code
  ),

  emp_final AS (
    SELECT *,
      CASE WHEN total_tasks = 0 THEN 0 ELSE
        GREATEST(0, LEAST(100, ROUND(
          (on_time_count + late_count + submitted_count)::numeric / total_tasks * 50
          + on_time_count::numeric / total_tasks * 30
          - overdue_count::numeric / total_tasks * 20
        )))
      END AS efficiency_score
    FROM emp_agg
  )

  SELECT jsonb_build_object(

    'period_days', p_days,
    'department',  p_department,
    'company',     p_company,

    'kpis', (
      SELECT jsonb_build_object(
        'total_tasks',      COUNT(*)               FILTER (WHERE NOT is_self_gen),
        'self_gen_count',   SUM(is_self_gen::int),
        'on_time_count',    SUM(is_on_time::int)   FILTER (WHERE NOT is_self_gen),
        'submitted_count',  SUM(is_submitted::int) FILTER (WHERE NOT is_self_gen),
        'overdue_count',    SUM(is_overdue::int)   FILTER (WHERE NOT is_self_gen),
        'stuck_count',      SUM(is_stuck::int)     FILTER (WHERE NOT is_self_gen),
        'total_employees',  COUNT(DISTINCT emp_email),
        'efficiency_score', CASE WHEN COUNT(*) FILTER (WHERE NOT is_self_gen) = 0 THEN 0 ELSE
          GREATEST(0, LEAST(100, ROUND(
            (SUM(is_on_time::int)    FILTER (WHERE NOT is_self_gen)
             + SUM(is_late::int)     FILTER (WHERE NOT is_self_gen)
             + SUM(is_submitted::int)FILTER (WHERE NOT is_self_gen))::numeric
             / COUNT(*) FILTER (WHERE NOT is_self_gen) * 50
            + SUM(is_on_time::int)   FILTER (WHERE NOT is_self_gen)::numeric
             / COUNT(*) FILTER (WHERE NOT is_self_gen) * 30
            - SUM(is_overdue::int)   FILTER (WHERE NOT is_self_gen)::numeric
             / COUNT(*) FILTER (WHERE NOT is_self_gen) * 20
          )))
        END
      )
      FROM task_base
    ),

    'task_breakdown', (
      SELECT jsonb_build_object(
        'on_time',   SUM(is_on_time::int)   FILTER (WHERE NOT is_self_gen),
        'late',      SUM(is_late::int)       FILTER (WHERE NOT is_self_gen),
        'submitted', SUM(is_submitted::int)  FILTER (WHERE NOT is_self_gen),
        'overdue',   SUM(is_overdue::int)    FILTER (WHERE NOT is_self_gen),
        'stuck',     SUM(is_stuck::int)      FILTER (WHERE NOT is_self_gen),
        'running',   SUM(is_running::int)    FILTER (WHERE NOT is_self_gen),
        'self_gen',  SUM(is_self_gen::int)
      )
      FROM task_base
    ),

    'employees', (
      SELECT jsonb_agg(jsonb_build_object(
        'email',            e.emp_email,
        'name',             e.emp_name,
        'employee_code',    e.employee_code,
        'total_tasks',      e.total_tasks,
        'self_gen_count',   e.self_gen_count,
        'on_time_count',    e.on_time_count,
        'submitted_count',  e.submitted_count,
        'overdue_count',    e.overdue_count,
        'stuck_count',      e.stuck_count,
        'efficiency_score', e.efficiency_score,
        'status', CASE
          WHEN e.efficiency_score >= 65 AND e.overdue_count = 0 THEN 'star'
          WHEN e.efficiency_score >= 55                          THEN 'on_track'
          WHEN e.efficiency_score >= 30                          THEN 'at_risk'
          ELSE                                                        'needs_help'
        END
      ) ORDER BY e.efficiency_score DESC)
      FROM emp_final e
    ),

    'stuck_tasks', (
      SELECT jsonb_agg(jsonb_build_object(
        'task_id',       tb.task_id,
        'task_name',     tb.task_name,
        'emp_email',     tb.emp_email,
        'emp_name',      tb.emp_name,
        'employee_code', tb.employee_code,
        'status',        tb.status,
        'stuck_reason',  tb.stuck_reason,
        'due_date',      tb.due_date,
        'days_overdue',  (CURRENT_DATE - tb.due_date)
      ) ORDER BY tb.due_date ASC)
      FROM task_base tb
      WHERE tb.is_stuck = true
    )

  ) INTO v_result;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$func$;

REVOKE EXECUTE ON FUNCTION public.get_hr_department_performance(text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_hr_department_performance(text, text, integer) TO service_role;
