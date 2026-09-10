-- Migration 243: HOD "My Team" performance tab
-- Adds can_view_team_performance permission and the get_hod_team_performance RPC.
-- The hod_department_access table was already created + seeded in the previous session.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. can_view_team_performance column on member_permissions
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE member_permissions
  ADD COLUMN IF NOT EXISTS can_view_team_performance boolean DEFAULT false;

-- Grant to every is_hod=true member
UPDATE member_permissions mp
SET can_view_team_performance = true
FROM members m
WHERE mp.member_id = m.id
  AND m.is_hod = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. get_hod_team_performance RPC
-- Returns DeptData-shaped JSONB scoped to the HOD's team only.
-- Finance HODs (single dept=Finance) are scoped by flw_employees.reports_to
-- so each co-HOD sees only their own sub-team, not the whole Finance dept.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_hod_team_performance(
  p_hod_email TEXT,
  p_days      INT DEFAULT 90
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
  v_cutoff      date    := CURRENT_DATE - (p_days || ' days')::interval;
  v_result      jsonb;
  v_depts       TEXT[];
  v_dept_label  TEXT;
  v_team_emails TEXT[];
  v_hod_first   TEXT;
  v_hod_flw_dept TEXT;
BEGIN

  -- 1. Get HOD's departments from access table
  SELECT array_agg(department ORDER BY department) INTO v_depts
  FROM hod_department_access
  WHERE lower(hod_email) = lower(p_hod_email);

  IF v_depts IS NULL THEN
    RETURN jsonb_build_object('error', 'No department access configured for this HOD');
  END IF;

  v_dept_label := array_to_string(v_depts, ' + ');

  -- 2. Build team email list
  IF 'Finance' = ANY(v_depts) AND array_length(v_depts, 1) = 1 THEN
    -- Finance sub-HOD: scope by flw_employees.reports_to + department
    -- Find HOD's first name and their FlowHCM department
    SELECT
      split_part(COALESCE(fe.full_name_override, fe.full_name), ' ', 1),
      fe.department
    INTO v_hod_first, v_hod_flw_dept
    FROM flw_employees fe
    WHERE lower(fe.email) = lower(p_hod_email)
    LIMIT 1;

    -- Fallback: derive first name from members.name
    IF v_hod_first IS NULL OR v_hod_first = '' THEN
      SELECT split_part(name, ' ', 1) INTO v_hod_first
      FROM members WHERE lower(email) = lower(p_hod_email) LIMIT 1;
    END IF;

    -- Team = members whose flw entry reports to this HOD in the same flw dept
    SELECT array_agg(DISTINCT m.email) INTO v_team_emails
    FROM flw_employees fe
    INNER JOIN members m ON lower(m.email) = lower(fe.email)
    WHERE fe.reports_to = v_hod_first
      AND (v_hod_flw_dept IS NULL OR fe.department = v_hod_flw_dept)
      AND m.is_active = true;

  ELSE
    -- Standard: all active members in the HOD's department(s)
    SELECT array_agg(DISTINCT m.email) INTO v_team_emails
    FROM members m
    WHERE m.department = ANY(v_depts)
      AND m.is_active = true;
  END IF;

  -- Always include HOD themselves (they have tasks too)
  v_team_emails := COALESCE(v_team_emails, ARRAY[]::TEXT[]);
  IF NOT (
    lower(p_hod_email) = ANY(
      SELECT lower(unnest(v_team_emails))
    )
  ) THEN
    v_team_emails := array_append(v_team_emails, lower(p_hod_email));
  END IF;

  -- 3. Task performance calculation
  WITH task_base AS (
    SELECT
      t.id                                                                        AS task_id,
      t.description                                                               AS task_name,
      t.assigned_to_email                                                         AS emp_email,
      t.due_date, t.status, t.stuck_reason,
      COALESCE(t.assigned_to_department, m.department)                            AS department,
      m.company                                                                   AS company,
      m.name                                                                      AS emp_name,
      m.employee_code                                                             AS employee_code,
      (t.assigned_to_email = t.assigned_by_email)                                AS is_self_gen,
      (t.status = 'Completed'
        AND COALESCE(t.submitted_at, t.completed_at)::date <= t.due_date)         AS is_on_time,
      (t.status = 'Completed'
        AND COALESCE(t.submitted_at, t.completed_at)::date >  t.due_date)         AS is_late,
      (t.status = 'Submitted')                                                    AS is_submitted,
      (t.status IN ('In Progress','Not Started')
        AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE)                AS is_overdue,
      (t.status IN ('Stuck','Waiting Reply'))                                     AS is_stuck,
      (t.status IN ('In Progress','Not Started')
        AND (t.due_date IS NULL OR t.due_date >= CURRENT_DATE))                  AS is_running
    FROM tasks t
    INNER JOIN members m ON m.email = t.assigned_to_email
    WHERE t.assigned_date  >= v_cutoff
      AND t.status         != 'Cancelled'
      AND lower(t.assigned_to_email) = ANY(
            SELECT lower(unnest(v_team_emails))
          )
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
    'company',     (SELECT company FROM members WHERE lower(email) = lower(p_hod_email) LIMIT 1),
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
