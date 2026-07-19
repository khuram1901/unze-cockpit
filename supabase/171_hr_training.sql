-- 171_hr_training.sql
-- T&D (Training & Development) Calendar: sessions, attendees, and feedback.
-- Apply via Supabase SQL Editor.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Training sessions
--    session_type: Internal (run in-house) or External (employee sent out)
--    status: Planned → Completed | Cancelled
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_td_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title           text NOT NULL,
  session_type    text NOT NULL DEFAULT 'Internal' CHECK (session_type IN ('Internal','External')),
  department      text,
  trainer         text,                 -- name of trainer / training provider
  session_date    date NOT NULL,
  duration_hours  numeric(5,1),
  location        text,
  cost_pkr        numeric(14,2),        -- relevant mainly for External
  max_attendees   integer,
  status          text NOT NULL DEFAULT 'Planned' CHECK (status IN ('Planned','Completed','Cancelled')),
  notes           text,
  -- Google Sheets feedback integration
  feedback_sheet_id   text,             -- Google Spreadsheet ID from the form's linked Sheet URL
  feedback_synced_at  timestamptz,      -- last time feedback was pulled from the Sheet
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hr_td_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read" ON hr_td_sessions;
DROP POLICY IF EXISTS "admin write"        ON hr_td_sessions;
CREATE POLICY "authenticated read" ON hr_td_sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write"        ON hr_td_sessions FOR ALL    TO authenticated
  USING      (EXISTS (SELECT 1 FROM members WHERE members.email = auth.jwt() ->> 'email' AND members.role IN ('Admin','CEO','Manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM members WHERE members.email = auth.jwt() ->> 'email' AND members.role IN ('Admin','CEO','Manager')));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_hr_td_sessions_updated_at') THEN
    CREATE TRIGGER set_hr_td_sessions_updated_at
      BEFORE UPDATE ON hr_td_sessions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Attendees — one row per employee per session
--    attended: NULL = not yet recorded, true = attended, false = absent
--    passed:   NULL = no assessment, true = passed, false = failed
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_td_attendees (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES hr_td_sessions(id) ON DELETE CASCADE,
  employee_name   text NOT NULL,
  employee_id     text,                 -- FlowHCM employee code if available
  department      text,
  attended        boolean,              -- NULL until marked
  passed          boolean,              -- NULL if no assessment
  certificate_url text,                 -- Folder.it link if cert issued
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, employee_name)
);

ALTER TABLE hr_td_attendees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read" ON hr_td_attendees;
DROP POLICY IF EXISTS "admin write"        ON hr_td_attendees;
CREATE POLICY "authenticated read" ON hr_td_attendees FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write"        ON hr_td_attendees FOR ALL    TO authenticated
  USING      (EXISTS (SELECT 1 FROM members WHERE members.email = auth.jwt() ->> 'email' AND members.role IN ('Admin','CEO','Manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM members WHERE members.email = auth.jwt() ->> 'email' AND members.role IN ('Admin','CEO','Manager')));

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Feedback — employees submit after attending a session
--    Ratings 1–5. All authenticated users can submit (not just admins).
--    One submission per employee name per session (unique constraint).
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_td_feedback (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL REFERENCES hr_td_sessions(id) ON DELETE CASCADE,
  employee_name    text NOT NULL,
  overall_rating   integer NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
  content_rating   integer          CHECK (content_rating BETWEEN 1 AND 5),
  trainer_rating   integer          CHECK (trainer_rating BETWEEN 1 AND 5),
  relevance_rating integer          CHECK (relevance_rating BETWEEN 1 AND 5),
  comments         text,
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, employee_name)
);

ALTER TABLE hr_td_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read"   ON hr_td_feedback;
DROP POLICY IF EXISTS "authenticated submit" ON hr_td_feedback;
DROP POLICY IF EXISTS "admin manage"         ON hr_td_feedback;
-- Any logged-in user can submit feedback
CREATE POLICY "authenticated submit" ON hr_td_feedback FOR INSERT TO authenticated WITH CHECK (true);
-- Anyone can read their own; admins can read all
CREATE POLICY "authenticated read"   ON hr_td_feedback FOR SELECT TO authenticated USING (true);
-- Admins can delete (e.g. spam/accidental duplicates)
CREATE POLICY "admin manage"         ON hr_td_feedback FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM members WHERE members.email = auth.jwt() ->> 'email' AND members.role IN ('Admin','CEO','Manager')));

-- ──────────────────────────────────────────────────────────────────────────
-- 4. RPC: get_td_summary — KPI cards in one round-trip
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_td_summary()
RETURNS TABLE (
  planned_this_month    bigint,
  completed_this_month  bigint,
  total_attendees_ytd   bigint,
  total_cost_ytd        numeric,
  avg_feedback_score    numeric,
  upcoming_count        bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*) FROM hr_td_sessions
       WHERE status = 'Planned'
         AND date_trunc('month', session_date) = date_trunc('month', CURRENT_DATE))    AS planned_this_month,
    (SELECT COUNT(*) FROM hr_td_sessions
       WHERE status = 'Completed'
         AND date_trunc('month', session_date) = date_trunc('month', CURRENT_DATE))    AS completed_this_month,
    (SELECT COUNT(*) FROM hr_td_attendees a
       JOIN hr_td_sessions s ON s.id = a.session_id
       WHERE a.attended = true
         AND EXTRACT(YEAR FROM s.session_date) = EXTRACT(YEAR FROM CURRENT_DATE))      AS total_attendees_ytd,
    (SELECT COALESCE(SUM(cost_pkr), 0) FROM hr_td_sessions
       WHERE EXTRACT(YEAR FROM session_date) = EXTRACT(YEAR FROM CURRENT_DATE))        AS total_cost_ytd,
    (SELECT ROUND(AVG(overall_rating)::numeric, 1) FROM hr_td_feedback f
       JOIN hr_td_sessions s ON s.id = f.session_id
       WHERE EXTRACT(YEAR FROM s.session_date) = EXTRACT(YEAR FROM CURRENT_DATE))      AS avg_feedback_score,
    (SELECT COUNT(*) FROM hr_td_sessions
       WHERE status = 'Planned'
         AND session_date >= CURRENT_DATE)                                              AS upcoming_count;
$$;

REVOKE ALL ON FUNCTION get_td_summary() FROM anon;
GRANT EXECUTE ON FUNCTION get_td_summary() TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. RPC: get_td_calendar — sessions for a given year+month with attendee
--    and feedback summary counts (for calendar grid rendering)
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_td_calendar(p_year int, p_month int)
RETURNS TABLE (
  session_id       uuid,
  company_id       uuid,
  company_name     text,
  title            text,
  session_type     text,
  department       text,
  trainer          text,
  session_date     date,
  duration_hours   numeric,
  status           text,
  cost_pkr         numeric,
  attendee_count   bigint,
  attended_count   bigint,
  feedback_count   bigint,
  avg_rating       numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id                                                                              AS session_id,
    s.company_id,
    c.name                                                                            AS company_name,
    s.title,
    s.session_type,
    s.department,
    s.trainer,
    s.session_date,
    s.duration_hours,
    s.status,
    s.cost_pkr,
    (SELECT COUNT(*)        FROM hr_td_attendees a WHERE a.session_id = s.id)         AS attendee_count,
    (SELECT COUNT(*)        FROM hr_td_attendees a WHERE a.session_id = s.id AND a.attended = true) AS attended_count,
    (SELECT COUNT(*)        FROM hr_td_feedback  f WHERE f.session_id = s.id)         AS feedback_count,
    (SELECT ROUND(AVG(overall_rating)::numeric,1) FROM hr_td_feedback f WHERE f.session_id = s.id) AS avg_rating
  FROM hr_td_sessions s
  JOIN companies c ON c.id = s.company_id
  WHERE EXTRACT(YEAR  FROM s.session_date) = p_year
    AND EXTRACT(MONTH FROM s.session_date) = p_month
  ORDER BY s.session_date ASC;
$$;

REVOKE ALL ON FUNCTION get_td_calendar(int, int) FROM anon;
GRANT EXECUTE ON FUNCTION get_td_calendar(int, int) TO authenticated;
