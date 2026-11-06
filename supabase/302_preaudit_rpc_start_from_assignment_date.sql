-- Fix: grid starts from assignment created_at so pre-assignment days don't appear red

CREATE OR REPLACE FUNCTION public.get_preaudit_my_tasks(p_email text, p_month date)
RETURNS TABLE (
  company_id    uuid,
  company_name  text,
  task_date     date,
  is_complete   boolean,
  is_late       boolean,
  completed_at  timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH member AS (
    SELECT id FROM public.members WHERE email = p_email LIMIT 1
  ),
  assignments AS (
    SELECT pa.company_id, pa.created_at::date AS start_date, c.name AS company_name
    FROM public.preaudit_assignments pa
    JOIN public.companies c ON c.id = pa.company_id
    WHERE pa.member_id = (SELECT id FROM member)
  ),
  working_days AS (
    SELECT gs::date AS task_date
    FROM generate_series(
      date_trunc('month', p_month)::date,
      (date_trunc('month', p_month) + interval '1 month - 1 day')::date,
      '1 day'::interval
    ) gs
    WHERE EXTRACT(DOW FROM gs) BETWEEN 1 AND 5
  ),
  grid AS (
    SELECT a.company_id, a.company_name, wd.task_date
    FROM assignments a CROSS JOIN working_days wd
    WHERE wd.task_date >= a.start_date  -- only days from assignment creation onwards
  )
  SELECT
    g.company_id,
    g.company_name,
    g.task_date,
    (pc.id IS NOT NULL)                                AS is_complete,
    (pc.completed_at AT TIME ZONE 'Asia/Karachi')::date > g.task_date AS is_late,
    pc.completed_at
  FROM grid g
  LEFT JOIN public.preaudit_completions pc
    ON pc.member_id = (SELECT id FROM member)
   AND pc.company_id = g.company_id
   AND pc.task_date = g.task_date
  ORDER BY g.task_date, g.company_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_preaudit_team_view(p_month date)
RETURNS TABLE (
  member_id     uuid,
  member_name   text,
  member_email  text,
  company_id    uuid,
  company_name  text,
  task_date     date,
  is_complete   boolean,
  is_late       boolean,
  completed_at  timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH assignments AS (
    SELECT
      pa.member_id,
      pa.created_at::date AS start_date,
      m.name  AS member_name,
      m.email AS member_email,
      pa.company_id,
      c.name  AS company_name
    FROM public.preaudit_assignments pa
    JOIN public.members  m ON m.id = pa.member_id
    JOIN public.companies c ON c.id = pa.company_id
  ),
  working_days AS (
    SELECT gs::date AS task_date
    FROM generate_series(
      date_trunc('month', p_month)::date,
      (date_trunc('month', p_month) + interval '1 month - 1 day')::date,
      '1 day'::interval
    ) gs
    WHERE EXTRACT(DOW FROM gs) BETWEEN 1 AND 5
  ),
  grid AS (
    SELECT a.member_id, a.member_name, a.member_email, a.company_id, a.company_name, wd.task_date
    FROM assignments a CROSS JOIN working_days wd
    WHERE wd.task_date >= a.start_date  -- only days from assignment creation onwards
  )
  SELECT
    g.member_id,
    g.member_name,
    g.member_email,
    g.company_id,
    g.company_name,
    g.task_date,
    (pc.id IS NOT NULL)                                AS is_complete,
    (pc.completed_at AT TIME ZONE 'Asia/Karachi')::date > g.task_date AS is_late,
    pc.completed_at
  FROM grid g
  LEFT JOIN public.preaudit_completions pc
    ON pc.member_id  = g.member_id
   AND pc.company_id = g.company_id
   AND pc.task_date  = g.task_date
  ORDER BY g.member_name, g.task_date, g.company_name;
END;
$$;
