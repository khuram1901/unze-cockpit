-- Migration 303: Fix get_preaudit_team_view to return member_id
-- Without member_id, the frontend Map keyed on member_id collapses all members
-- into a single undefined key, showing only one member in the team view.

DROP FUNCTION IF EXISTS get_preaudit_team_view(date);

CREATE FUNCTION get_preaudit_team_view(p_month date)
RETURNS TABLE(member_id uuid, member_email text, member_name text, company_id uuid, company_name text,
  task_date date, is_complete boolean, completed_at timestamptz, completed_late boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH assignments AS (
    SELECT pa.company_id, c.name AS company_name,
           m.id AS member_id, m.email AS member_email, m.name AS member_name
    FROM preaudit_assignments pa
    JOIN companies c ON c.id = pa.company_id
    JOIN members m ON m.id = pa.member_id
  ),
  working_days AS (
    SELECT d::date AS task_date
    FROM generate_series(date_trunc('month', p_month), date_trunc('month', p_month) + interval '1 month' - interval '1 day', interval '1 day') d
    WHERE extract(dow FROM d) BETWEEN 1 AND 5
  ),
  grid AS (
    SELECT wd.task_date, a.company_id, a.company_name,
           a.member_id, a.member_email, a.member_name
    FROM working_days wd CROSS JOIN assignments a
  ),
  completions AS (
    SELECT pc.member_id, pc.company_id, pc.task_date AS comp_date, pc.completed_at,
           (pc.completed_at::date > pc.task_date) AS completed_late
    FROM preaudit_completions pc
    WHERE date_trunc('month', pc.task_date) = date_trunc('month', p_month)
  )
  SELECT g.member_id, g.member_email, g.member_name, g.company_id, g.company_name, g.task_date,
    (comp.comp_date IS NOT NULL) AS is_complete, comp.completed_at,
    COALESCE(comp.completed_late, false) AS completed_late
  FROM grid g
  LEFT JOIN completions comp ON comp.member_id = g.member_id AND comp.company_id = g.company_id AND comp.comp_date = g.task_date
  ORDER BY g.task_date, g.member_name, g.company_name;
END; $$;
