-- 174_hr_recruitment.sql
-- Extends recruitment_positions for FlowHCM import + adds candidates table + RPCs.
-- Apply via Supabase SQL Editor.

-- ── 1. Extend recruitment_positions ────────────────────────────────────────────
ALTER TABLE recruitment_positions
  ADD COLUMN IF NOT EXISTS salary_range       text,
  ADD COLUMN IF NOT EXISTS required_count     integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS date_closed        date,
  ADD COLUMN IF NOT EXISTS on_hold_date       date,
  ADD COLUMN IF NOT EXISTS re_opened_date     date,
  ADD COLUMN IF NOT EXISTS re_closed_date     date,
  ADD COLUMN IF NOT EXISTS assigned_to        text,
  ADD COLUMN IF NOT EXISTS flw_remarks        text,
  ADD COLUMN IF NOT EXISTS flw_company        text,
  ADD COLUMN IF NOT EXISTS selected_candidate text,
  ADD COLUMN IF NOT EXISTS offered_salary     text,
  ADD COLUMN IF NOT EXISTS import_source      text DEFAULT 'manual';

-- Partial unique index for idempotent FlowHCM re-imports
-- (same position at the same company opened on the same date = same record)
CREATE UNIQUE INDEX IF NOT EXISTS recruitment_positions_flw_key
  ON recruitment_positions (lower(trim(position_title)), lower(trim(flw_company)), date_opened)
  WHERE date_opened IS NOT NULL AND flw_company IS NOT NULL;

-- ── 2. Recruitment candidates table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recruitment_candidates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id      uuid NOT NULL REFERENCES recruitment_positions(id) ON DELETE CASCADE,
  name             text NOT NULL,
  contact          text,
  email            text,
  personality_test text,
  overview         text,
  cv_link          text,
  feedback         jsonb  DEFAULT '{}',
  stage            text   DEFAULT 'Applied',
  offer_amount     text,
  date_of_joining  date,
  created_at       timestamptz DEFAULT now(),
  CONSTRAINT recruitment_candidates_stage_check CHECK (
    stage IN ('Applied','Screening','Interview','Offer','Hired','Rejected')
  )
);

ALTER TABLE recruitment_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rc_read"   ON recruitment_candidates;
DROP POLICY IF EXISTS "rc_insert" ON recruitment_candidates;
DROP POLICY IF EXISTS "rc_update" ON recruitment_candidates;
DROP POLICY IF EXISTS "rc_delete" ON recruitment_candidates;

CREATE POLICY "rc_read"   ON recruitment_candidates FOR SELECT TO authenticated USING (true);
CREATE POLICY "rc_insert" ON recruitment_candidates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "rc_update" ON recruitment_candidates FOR UPDATE TO authenticated USING (true);
CREATE POLICY "rc_delete" ON recruitment_candidates FOR DELETE TO authenticated USING (true);

-- ── 3. RPC: get_recruitment_summary ────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_recruitment_summary();

CREATE OR REPLACE FUNCTION get_recruitment_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total',            COUNT(*),
    'open',             COUNT(*) FILTER (WHERE status IN ('Open','Interviewing')),
    'filled',           COUNT(*) FILTER (WHERE status = 'Filled'),
    'on_hold',          COUNT(*) FILTER (WHERE status = 'On Hold'),
    'long_open',        COUNT(*) FILTER (
                          WHERE status IN ('Open','Interviewing')
                            AND date_opened IS NOT NULL
                            AND date_opened < CURRENT_DATE - INTERVAL '60 days'
                        ),
    'avg_days_to_hire', ROUND(AVG(
                          CASE WHEN status = 'Filled'
                                AND date_opened IS NOT NULL
                                AND date_closed IS NOT NULL
                            THEN (date_closed - date_opened)::numeric
                          END
                        )),
    'filled_this_month', COUNT(*) FILTER (
                           WHERE status = 'Filled'
                             AND date_closed >= date_trunc('month', CURRENT_DATE)
                         )
  )
  INTO result
  FROM recruitment_positions;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_recruitment_summary() TO authenticated;

-- ── 4. RPC: get_recruitment_positions ──────────────────────────────────────────
DROP FUNCTION IF EXISTS get_recruitment_positions(text, text);

CREATE OR REPLACE FUNCTION get_recruitment_positions(
  p_status  text DEFAULT NULL,
  p_company text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',                 p.id,
        'position_title',     p.position_title,
        'flw_company',        COALESCE(p.flw_company, 'Unknown'),
        'salary_range',       p.salary_range,
        'assigned_to',        p.assigned_to,
        'date_opened',        p.date_opened,
        'date_closed',        p.date_closed,
        'days_open',          CASE WHEN p.date_opened IS NOT NULL
                                THEN (CURRENT_DATE - p.date_opened)
                              END,
        'required_count',     COALESCE(p.required_count, 1),
        'status',             p.status,
        'selected_candidate', p.selected_candidate,
        'offered_salary',     p.offered_salary,
        'flw_remarks',        p.flw_remarks,
        'candidate_count',    (SELECT COUNT(*)::int FROM recruitment_candidates c WHERE c.position_id = p.id)
      )
      ORDER BY p.date_opened DESC NULLS LAST
    ), '[]'::jsonb)
    FROM recruitment_positions p
    WHERE (p_status  IS NULL OR p.status = p_status)
      AND (p_company IS NULL OR p.flw_company ILIKE '%' || p_company || '%')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_recruitment_positions(text, text) TO authenticated;

-- ── 5. RPC: get_position_candidates ────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_position_candidates(uuid);

CREATE OR REPLACE FUNCTION get_position_candidates(p_position_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',               c.id,
        'name',             c.name,
        'contact',          c.contact,
        'email',            c.email,
        'personality_test', c.personality_test,
        'overview',         c.overview,
        'cv_link',          c.cv_link,
        'feedback',         c.feedback,
        'stage',            c.stage,
        'offer_amount',     c.offer_amount,
        'date_of_joining',  c.date_of_joining
      )
      ORDER BY c.created_at ASC
    ), '[]'::jsonb)
    FROM recruitment_candidates c
    WHERE c.position_id = p_position_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_position_candidates(uuid) TO authenticated;
