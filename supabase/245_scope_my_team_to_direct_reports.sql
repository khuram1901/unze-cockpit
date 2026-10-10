-- Migration 245: Scope My Team to direct reports only
-- Replaces department-based scoping with manager_id-based scoping.
-- Every manager (including CEO) now sees only people who report directly to them.

CREATE OR REPLACE FUNCTION public.get_hod_team_performance(
  p_hod_email TEXT,
  p_days      INT DEFAULT 90
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_cutoff      date := CURRENT_DATE - (p_days || ' days')::interval;
  v_result      jsonb;
  v_manager_id  uuid;
  v_dept_label  TEXT := 'My Team';
  v_team_emails TEXT[];
BEGIN

  -- 1. Resolve caller to a member record
  SELECT id INTO v_manager_id
  FROM members
  WHERE lower(email) = lower(p_hod_email)
    AND is_active = true
  LIMIT 1;

  IF v_manager_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Member not found');
  END IF;

  -- 2. Collect direct reports only (manager_id = this member's id)
  SELECT array_agg(DISTINCT lower(m.email)) INTO v_team_emails
  FROM members m
  WHERE m.manager_id = v_manager_id
    AND m.is_active = true;

  -- No direct reports — return a valid empty structure (not an error)
  IF v_team_emails IS NULL OR array_length(v_team_emails, 1) = 0 THEN
    RETURN jsonb_build_object(
      'period_days',     p_days,
      'department',      v_dept_label,
      'company',         (SELECT company FROM members WHERE id = v_manager_id LIMIT 1),
      'kpis', jsonb_build_object(
        'total_tasks', 0, 'self_gen_count', 0, 'on_time_count', 0,
        'submitted_count', 0, 'overdue_count', 0, 'stuck_count', 0,
        'total_employees', 0, 'efficiency_score', 0
      ),
      'task_breakdown', jsonb_build_object(
        'on_time', 0, 'late', 0, 'submitted', 0,
        'overdue', 0, 'stuck', 0, 'running', 0, 'self_gen', 0
      ),
      'employees',   '[]'::jsonb,
      'stuck_tasks', '[]'::jsonb
    );
  END IF;

  -- 3. Task performance calculation (identical logic, new scope)
  WITH task_base AS (
    SELECT
      t.id                                                                         AS task_id,
      t.description                                                                AS task_name,
      t.assigned_to_email                                                          AS emp_email,
      t.due_date, t.status, t.stuck_reason,
      COALESCE(t.assigned_to_department, m.department)                             AS department,
      m.company                                                                    AS company,
      m.name                                                                       AS emp_name,
      m.employee_code                                                              AS employee_code,
      (t.assigned_to_email = t.assigned_by_email)                                 AS is_self_gen,
      (t.status = 'Completed'
        AND COALESCE(t.submitted_at, t.completed_at)::date <= t.due_date)          AS is_on_time,
      (t.status = 'Completed'
        AND COALESCE(t.submitted_at, t.completed_at)::date >  t.due_date)          AS is_late,
      (t.status = 'Submitted')                                                     AS is_submitted,
      (t.status IN ('In Progress','Not Started')
        AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE)                 AS is_overdue,
      (t.status IN ('Stuck','Waiting Reply'))                                      AS is_stuck,
      (t.status IN ('In Progress','Not Started')
        AND (t.due_date IS NULL OR t.due_date >= CURRENT_DATE))                   AS is_running
    FROM tasks t
    INNER JOIN members m ON lower(m.email) = lower(t.assigned_to_email)
    WHERE t.assigned_date  >= v_cutoff
      AND t.status         != 'Cancelled'
      AND lower(t.assigned_to_email) = ANY(v_team_emails)
      AND m.is_active       = true
      AND m.name NOT ILIKE ANY(ARRAY[
            '%meeting minutes%','%recurring template%','%system%','%auto%'
          ])
  ),

  emp_agg AS (
    SELECT
      emp_email, emp_name, department, company, employee_code,
      COUNT(*)                                            FILTER (WHERE NOT is_self_gen) AS total_tasks,
      SUM(is_self_gen::int)                                                              AS self_gen_count,
      SUM(is_on_time::int)    FILTER (WHERE NOT is_self_gen)                            AS on_time_count,
      SUM(is_late::int)       FILTER (WHERE NOT is_self_gen)                            AS late_count,
      SUM(is_submitted::int)  FILTER (WHERE NOT is_self_gen)                            AS submitted_count,
      SUM(is_overdue::int)    FILTER (WHERE NOT is_self_gen)                            AS overdue_count,
      SUM(is_stuck::int)      FILTER (WHERE NOT is_self_gen)                            AS stuck_count,
      SUM(is_running::int)    FILTER (WHERE NOT is_self_gen)                            AS running_count
    FROM task_base
    GROUP BY emp_email, emp_name, department, company, employee_code
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
    'department',  v_dept_label,
    'company',     (SELECT company FROM members WHERE id = v_manager_id LIMIT 1),
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
          ))) END
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
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'email',            e.emp_email,
        'emp_name',         e.emp_name,
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
        'status', CASE
          WHEN e.efficiency_score >= 65 AND e.overdue_count = 0 THEN 'star'
          WHEN e.efficiency_score >= 55                          THEN 'on_track'
          WHEN e.efficiency_score >= 30                          THEN 'at_risk'
          ELSE                                                        'needs_help'
        END
      ) ORDER BY e.efficiency_score DESC), '[]'::jsonb)
      FROM emp_final e
    ),
    'stuck_tasks', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'task_id',       tb.task_id,
        'task_name',     tb.task_name,
        'emp_name',      tb.emp_name,
        'employee_code', tb.employee_code,
        'department',    tb.department,
        'status',        tb.status,
        'stuck_reason',  tb.stuck_reason,
        'due_date',      tb.due_date,
        'days_overdue',  (CURRENT_DATE - tb.due_date)
      ) ORDER BY tb.due_date ASC), '[]'::jsonb)
      FROM task_base tb
      WHERE tb.is_stuck = true
    )
  ) INTO v_result;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$func$;

REVOKE EXECUTE ON FUNCTION public.get_hod_team_performance(text, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_hod_team_performance(text, integer) TO service_role;
