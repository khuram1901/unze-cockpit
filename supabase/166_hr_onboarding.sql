-- 166_hr_onboarding.sql
-- HR Onboarding: orientation modules, sections, quiz questions, and completion records.
-- Apply via Supabase SQL Editor.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Orientation modules
--    One module = one full orientation programme (e.g. "UTPL New Joiner").
--    A company can have multiple modules (e.g. one per department).
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_onboarding_modules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid REFERENCES companies(id) ON DELETE SET NULL,
  title       text NOT NULL,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hr_onboarding_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read" ON hr_onboarding_modules
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin write" ON hr_onboarding_modules
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM members
      WHERE members.email = auth.jwt() ->> 'email'
        AND members.role IN ('Admin', 'CEO', 'Manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM members
      WHERE members.email = auth.jwt() ->> 'email'
        AND members.role IN ('Admin', 'CEO', 'Manager')
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Orientation sections (ordered content within a module)
--    section_type: 'video' | 'document' | 'text'
--    For video/document: folderit_file_id holds the Folder.it file identifier,
--    content_url holds the direct link to display/embed.
--    For text: content_text holds HTML or plain text.
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_onboarding_sections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id        uuid NOT NULL REFERENCES hr_onboarding_modules(id) ON DELETE CASCADE,
  order_index      integer NOT NULL DEFAULT 0,
  section_type     text NOT NULL CHECK (section_type IN ('video', 'document', 'text')),
  title            text NOT NULL,
  content_url      text,          -- Folder.it share/embed URL for video or document
  folderit_file_id text,          -- Folder.it file ID (for future API calls)
  content_text     text,          -- Used when section_type = 'text'
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hr_onboarding_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read" ON hr_onboarding_sections
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin write" ON hr_onboarding_sections
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM members
      WHERE members.email = auth.jwt() ->> 'email'
        AND members.role IN ('Admin', 'CEO', 'Manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM members
      WHERE members.email = auth.jwt() ->> 'email'
        AND members.role IN ('Admin', 'CEO', 'Manager')
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Quiz questions (multiple-choice, 4 options each)
--    options:         JSON array of 4 strings
--    correct_option:  0-indexed integer (0–3)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_onboarding_quiz_questions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id      uuid NOT NULL REFERENCES hr_onboarding_modules(id) ON DELETE CASCADE,
  order_index    integer NOT NULL DEFAULT 0,
  question       text NOT NULL,
  options        jsonb NOT NULL,   -- ["Option A", "Option B", "Option C", "Option D"]
  correct_option integer NOT NULL CHECK (correct_option BETWEEN 0 AND 3),
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hr_onboarding_quiz_questions ENABLE ROW LEVEL SECURITY;

-- Employees can read questions while taking the quiz.
-- Correct answers are revealed only after quiz submission (enforced in app logic).
CREATE POLICY "authenticated read" ON hr_onboarding_quiz_questions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin write" ON hr_onboarding_quiz_questions
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM members
      WHERE members.email = auth.jwt() ->> 'email'
        AND members.role IN ('Admin', 'CEO', 'Manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM members
      WHERE members.email = auth.jwt() ->> 'email'
        AND members.role IN ('Admin', 'CEO', 'Manager')
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Completion records — one row per (module, employee)
--    sections_viewed: JSON array of section UUIDs the employee has opened.
--    quiz_answers:    JSON array of integers (0–3), one per question, in order.
--    quiz_score:      percentage 0–100.
--    quiz_passed:     true if score >= 80.
--    completed_at:    set when quiz is submitted and passed.
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_onboarding_completions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id          uuid NOT NULL REFERENCES hr_onboarding_modules(id) ON DELETE CASCADE,
  member_email       text NOT NULL,
  member_name        text,
  started_at         timestamptz NOT NULL DEFAULT now(),
  sections_viewed    jsonb NOT NULL DEFAULT '[]',   -- array of section UUIDs
  quiz_started_at    timestamptz,
  quiz_completed_at  timestamptz,
  quiz_score         integer,                       -- 0–100
  quiz_passed        boolean,
  quiz_answers       jsonb,                         -- array of integers (chosen option indices)
  completed_at       timestamptz,                   -- null until quiz passed
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module_id, member_email)
);

ALTER TABLE hr_onboarding_completions ENABLE ROW LEVEL SECURITY;

-- Each employee can only see/edit their own completion record.
CREATE POLICY "own record" ON hr_onboarding_completions
  FOR ALL TO authenticated
  USING (member_email = auth.jwt() ->> 'email')
  WITH CHECK (member_email = auth.jwt() ->> 'email');

-- Admin/CEO/Manager can read all records (for the completion dashboard).
CREATE POLICY "admin read all" ON hr_onboarding_completions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM members
      WHERE members.email = auth.jwt() ->> 'email'
        AND members.role IN ('Admin', 'CEO', 'Manager')
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 5. RPC: get_onboarding_summary
--    Returns module list with counts — used for the admin KPI cards.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_onboarding_summary()
RETURNS TABLE (
  module_id       uuid,
  module_title    text,
  company_id      uuid,
  is_active       boolean,
  section_count   bigint,
  question_count  bigint,
  completions     bigint,
  passes          bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id              AS module_id,
    m.title           AS module_title,
    m.company_id,
    m.is_active,
    (SELECT COUNT(*) FROM hr_onboarding_sections s WHERE s.module_id = m.id) AS section_count,
    (SELECT COUNT(*) FROM hr_onboarding_quiz_questions q WHERE q.module_id = m.id) AS question_count,
    (SELECT COUNT(*) FROM hr_onboarding_completions c WHERE c.module_id = m.id AND c.completed_at IS NOT NULL) AS completions,
    (SELECT COUNT(*) FROM hr_onboarding_completions c WHERE c.module_id = m.id AND c.quiz_passed = true) AS passes
  FROM hr_onboarding_modules m
  ORDER BY m.created_at DESC;
$$;

REVOKE ALL ON FUNCTION get_onboarding_summary() FROM anon;
GRANT EXECUTE ON FUNCTION get_onboarding_summary() TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 6. updated_at trigger on modules
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_hr_onboarding_modules_updated_at'
  ) THEN
    CREATE TRIGGER set_hr_onboarding_modules_updated_at
      BEFORE UPDATE ON hr_onboarding_modules
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;
