-- 183_tax_schedule_audit.sql
-- Audit log for every accounts schedule status change
-- Enables reporting on: who moved what, when, and how long each stage took
-- Apply via Supabase SQL Editor

CREATE TABLE IF NOT EXISTS tax_schedule_audit (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tax_year     text        NOT NULL,
  section      text        NOT NULL,  -- Q1, Q2, Q3, Q4, Annual
  step_index   integer     NOT NULL,
  entity_key   text        NOT NULL,  -- UT, IMP, BARANH, etc.
  entity_label text        NOT NULL,  -- Unze Trading, Imperial, etc.
  step_label   text        NOT NULL,  -- e.g. "Recording in Sage"
  from_status  text        NOT NULL,
  to_status    text        NOT NULL,
  changed_by   text        NOT NULL,  -- email of user who made the change
  changed_at   timestamptz DEFAULT NOW() NOT NULL
);

-- For reporting: all changes for a given year/entity
CREATE INDEX IF NOT EXISTS tax_schedule_audit_year_entity
  ON tax_schedule_audit (tax_year, entity_key, section, step_index, changed_at);

-- For user activity reports
CREATE INDEX IF NOT EXISTS tax_schedule_audit_user
  ON tax_schedule_audit (changed_by, changed_at);

-- ── Convenience view: time spent per stage ────────────────────────────────────
-- Shows the elapsed time between each "entry" status change and the next one.
-- Use this to answer "how long did Recording in Sage take for Unze Trading Q1?"

CREATE OR REPLACE VIEW tax_schedule_stage_durations AS
SELECT
  a.tax_year,
  a.section,
  a.step_index,
  a.step_label,
  a.entity_key,
  a.entity_label,
  a.from_status,
  a.to_status,
  a.changed_by,
  a.changed_at                                        AS moved_at,
  LEAD(a.changed_at) OVER (
    PARTITION BY a.tax_year, a.section, a.step_index, a.entity_key
    ORDER BY a.changed_at
  )                                                   AS next_change_at,
  EXTRACT(EPOCH FROM (
    LEAD(a.changed_at) OVER (
      PARTITION BY a.tax_year, a.section, a.step_index, a.entity_key
      ORDER BY a.changed_at
    ) - a.changed_at
  )) / 86400.0                                        AS days_in_stage
FROM tax_schedule_audit a;

COMMENT ON TABLE tax_schedule_audit IS
  'Immutable log of every accounts-schedule status change. Never update or delete rows.';
