-- Migration 197: Legal Case Tracking System
-- Apply manually via Supabase SQL Editor.
--
-- Tables:
--   legal_cases         — one row per accused person / incident
--   legal_case_updates  — running log of every follow-up action

-- ── Case number sequence ─────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS legal_case_seq START 1;

-- ── Main cases table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS legal_cases (
  id                   UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  case_number          TEXT    UNIQUE NOT NULL,

  -- Location
  entity               TEXT    NOT NULL,          -- UTPL | IFPL | Baranh | HD
  location_id          UUID    REFERENCES admin_locations(id),
  location_name        TEXT    NOT NULL,

  -- Accused person
  subject_name         TEXT    NOT NULL,
  subject_role         TEXT,                      -- Store Manager, Staff, Supervisor …
  subject_employee_id  TEXT,

  -- Offence
  offence_type         TEXT    NOT NULL,          -- Stock Shortage | Theft | Fraud | Harassment | Misconduct | Property Damage | Other
  description          TEXT,
  incident_date        DATE,
  amount_involved_pkr  NUMERIC,

  -- Status (updated by daily-entry field team)
  status               TEXT    NOT NULL DEFAULT 'HR Documents Issued',
  -- Valid values:
  --   HR Documents Issued → Police Report Filed → FIR Registered →
  --   Warrant Issued → Under Investigation → Court Proceedings →
  --   Resolved | Closed

  -- Legal reference numbers (filled in as the case progresses)
  police_station       TEXT,
  fir_number           TEXT,
  fir_date             DATE,
  warrant_number       TEXT,
  warrant_date         DATE,
  court_case_number    TEXT,

  -- Resolution (filled when status = Resolved / Closed)
  amount_recovered_pkr NUMERIC,
  resolution_type      TEXT,   -- Recovered | Convicted | Acquitted | Settled | Dropped
  resolution_notes     TEXT,

  -- Meta
  initiated_by         TEXT    NOT NULL,  -- HR person email
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ── Follow-up log ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS legal_case_updates (
  id                UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id           UUID  NOT NULL REFERENCES legal_cases(id) ON DELETE CASCADE,

  -- What happened
  update_type       TEXT  NOT NULL,   -- Police Station Visit | Court Hearing | Authority Meeting | Document Submitted | FIR Registration | Warrant Execution | Status Update | Other
  update_date       DATE  NOT NULL DEFAULT CURRENT_DATE,
  description       TEXT  NOT NULL,

  -- Status transition (if the field team advanced the status)
  status_before     TEXT,
  status_after      TEXT,

  -- Reference numbers captured during this update
  fir_number        TEXT,
  warrant_number    TEXT,
  court_case_number TEXT,

  -- Next steps
  next_action       TEXT,
  next_action_date  DATE,

  -- Who logged this
  entered_by        TEXT  NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_legal_cases_entity    ON legal_cases(entity);
CREATE INDEX IF NOT EXISTS idx_legal_cases_status    ON legal_cases(status);
CREATE INDEX IF NOT EXISTS idx_legal_case_updates_case ON legal_case_updates(case_id);

-- ── Updated_at trigger ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_legal_case_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_legal_cases_updated_at ON legal_cases;
CREATE TRIGGER trg_legal_cases_updated_at
  BEFORE UPDATE ON legal_cases
  FOR EACH ROW EXECUTE FUNCTION update_legal_case_timestamp();
