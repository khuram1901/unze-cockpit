-- Migration 299: Pre-Audit daily task tracking
-- Tracks per-member, per-company daily audit trail checks (Mon–Fri)
-- Applied: 2026-11-06

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.preaudit_assignments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id  UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, company_id)
);

CREATE TABLE IF NOT EXISTS public.preaudit_completions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  task_date    DATE NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, company_id, task_date)
);

CREATE INDEX IF NOT EXISTS preaudit_completions_member_date
  ON public.preaudit_completions (member_id, task_date);
CREATE INDEX IF NOT EXISTS preaudit_completions_company_date
  ON public.preaudit_completions (company_id, task_date);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.preaudit_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preaudit_completions ENABLE ROW LEVEL SECURITY;

-- Assignments: members see their own; admins/managers see all
CREATE POLICY "preaudit_assignments_select" ON public.preaudit_assignments
  FOR SELECT USING (
    member_id = (SELECT id FROM public.members WHERE email = auth.email() LIMIT 1)
    OR EXISTS (
      SELECT 1 FROM public.members
      WHERE email = auth.email() AND role IN ('Admin', 'Manager')
    )
  );

-- No direct INSERT/UPDATE/DELETE — managed via service role in API routes

-- Completions: members see their own; admins/managers see all
CREATE POLICY "preaudit_completions_select" ON public.preaudit_completions
  FOR SELECT USING (
    member_id = (SELECT id FROM public.members WHERE email = auth.email() LIMIT 1)
    OR EXISTS (
      SELECT 1 FROM public.members
      WHERE email = auth.email() AND role IN ('Admin', 'Manager')
    )
  );

-- ── Seed assignments ──────────────────────────────────────────────────────────
-- Attia → Baranh, Haute Dolci
-- Abdul Rehman → Imperial Footwear
-- Fraz → Unze Trading

INSERT INTO public.preaudit_assignments (member_id, company_id) VALUES
  -- Attia + Baranh
  ('9b848c63-eea2-4414-a75e-18ffde62b512', '6401ba75-f297-4617-84c1-305bcaf35a50'),
  -- Attia + Haute Dolci
  ('9b848c63-eea2-4414-a75e-18ffde62b512', '16a92b7f-b3fa-4271-819b-c6befb534f12'),
  -- Abdul Rehman + Imperial Footwear
  ('b83f5a62-03ac-4d2d-848f-364046c52bf5', '77921705-8a15-4406-847a-b234f84b5ec3'),
  -- Fraz + Unze Trading
  ('067e71ea-468a-4052-9444-4ed0a8fb6951', '15884c2d-48a4-4d43-be90-0ef6e130790c')
ON CONFLICT (member_id, company_id) DO NOTHING;

-- ── RPC: get_preaudit_my_tasks ────────────────────────────────────────────────
-- Returns the authenticated user's monthly calendar data.
-- Each row = one (company, task_date) combination for working days in the month.
-- Includes completion status and whether it was done late.

CREATE OR REPLACE FUNCTION public.get_preaudit_my_tasks(
  p_email TEXT,
  p_month DATE   -- first day of the month, e.g. '2026-11-01'
)
RETURNS TABLE (
  company_id    UUID,
  company_name  TEXT,
  task_date     DATE,
  is_complete   BOOLEAN,
  is_late       BOOLEAN,
  completed_at  TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH member AS (
    SELECT id FROM public.members WHERE email = p_email LIMIT 1
  ),
  assignments AS (
    SELECT pa.company_id, c.name AS company_name
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
    WHERE EXTRACT(DOW FROM gs) BETWEEN 1 AND 5  -- Mon=1 to Fri=5
  ),
  grid AS (
    SELECT a.company_id, a.company_name, wd.task_date
    FROM assignments a CROSS JOIN working_days wd
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
$$;

-- ── RPC: get_preaudit_team_view ───────────────────────────────────────────────
-- Returns team-level view for the manager.
-- Each row = one (member, company, task_date) for the given month.

CREATE OR REPLACE FUNCTION public.get_preaudit_team_view(
  p_month DATE
)
RETURNS TABLE (
  member_id     UUID,
  member_name   TEXT,
  member_email  TEXT,
  company_id    UUID,
  company_name  TEXT,
  task_date     DATE,
  is_complete   BOOLEAN,
  is_late       BOOLEAN,
  completed_at  TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH assignments AS (
    SELECT
      pa.member_id,
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
$$;

-- ── RPC: complete_preaudit_task ───────────────────────────────────────────────
-- Upserts a completion row for the given member + company + date.
-- Returns the completion id on success.

CREATE OR REPLACE FUNCTION public.complete_preaudit_task(
  p_email      TEXT,
  p_company_id UUID,
  p_task_date  DATE,
  p_notes      TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id UUID;
  v_id        UUID;
BEGIN
  SELECT id INTO v_member_id FROM public.members WHERE email = p_email LIMIT 1;
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Member not found for email %', p_email;
  END IF;

  -- Verify assignment exists
  IF NOT EXISTS (
    SELECT 1 FROM public.preaudit_assignments
    WHERE member_id = v_member_id AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'No assignment for this member and company';
  END IF;

  INSERT INTO public.preaudit_completions (member_id, company_id, task_date, notes)
  VALUES (v_member_id, p_company_id, p_task_date, p_notes)
  ON CONFLICT (member_id, company_id, task_date)
  DO UPDATE SET completed_at = now(), notes = EXCLUDED.notes
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ── RPC: get_preaudit_weekly_email_data ───────────────────────────────────────
-- Returns team summary for the weekly email to Shahid.
-- p_week_start = Monday of the target week.

CREATE OR REPLACE FUNCTION public.get_preaudit_weekly_email_data(
  p_week_start DATE  -- Monday
)
RETURNS TABLE (
  member_name   TEXT,
  member_email  TEXT,
  company_name  TEXT,
  task_date     DATE,
  is_complete   BOOLEAN,
  is_late       BOOLEAN,
  completed_at  TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH week_days AS (
    SELECT gs::date AS task_date
    FROM generate_series(p_week_start, p_week_start + 4, '1 day'::interval) gs
    WHERE EXTRACT(DOW FROM gs) BETWEEN 1 AND 5
  ),
  assignments AS (
    SELECT
      pa.member_id,
      m.name  AS member_name,
      m.email AS member_email,
      pa.company_id,
      c.name       AS company_name
    FROM public.preaudit_assignments pa
    JOIN public.members  m ON m.id = pa.member_id
    JOIN public.companies c ON c.id = pa.company_id
  ),
  grid AS (
    SELECT a.member_id, a.member_name, a.member_email, a.company_id, a.company_name, wd.task_date
    FROM assignments a CROSS JOIN week_days wd
  )
  SELECT
    g.member_name,
    g.member_email,
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
  ORDER BY g.member_name, g.company_name, g.task_date;
$$;

-- ── Grant execute to authenticated users ──────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.get_preaudit_my_tasks(TEXT, DATE)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_preaudit_team_view(DATE)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_preaudit_task(TEXT, UUID, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_preaudit_weekly_email_data(DATE)      TO authenticated;
