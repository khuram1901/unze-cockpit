-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 251: FlowHCM lifecycle lockdown — formally tracked
-- ─────────────────────────────────────────────────────────────────────────────
-- BACKGROUND
-- ----------
-- Migration 236_flowhcm_lifecycle_lockdown.sql was applied manually to the DB
-- (confirmed live: sync_member_lifecycle is already log-only) but was never
-- registered in supabase_migrations. This migration formally tracks it so the
-- lockdown survives any future migration replay or DB reset.
--
-- WHAT THIS DOES
-- --------------
-- Replaces sync_member_lifecycle() with a log-only version:
--   • FlowHCM leaver flags → 'leaver_flagged' event, NO write to members.is_active
--   • FlowHCM manager diff → 'manager_mismatch' or 'manager_ambiguous' event,
--                             NO write to members.manager_id
--
-- FIELDS FLOWHCM IS PERMANENTLY FORBIDDEN FROM WRITING TO members:
--   is_active, manager_id, company_id, company, department, role,
--   is_hod, task_default_company_id, and all permission/access fields.
--
-- The ONLY field FlowHCM may write to members is: name
-- (via sync_member_names_from_flw — migration 232, Cockpit-first, lifecycle-exempt aware).
--
-- The app is the sole source of truth for hierarchy, company, role, and access.
-- FlowHCM is the source of truth for identity (name, employee code) only.
--
-- IDEMPOTENCY
-- -----------
-- CREATE OR REPLACE — safe to re-run. No schema changes. No data changes.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_member_lifecycle()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

  -- ── Block 1: Leaver detection ─────────────────────────────────────────────
  -- LOG ONLY. Do NOT set members.is_active = false.
  -- If FlowHCM marks an employee inactive/leaver and their app account is still
  -- active, log 'leaver_flagged' so an admin can review and deactivate manually.
  -- lifecycle_exempt members are handled separately in Block 2.
  -- Dedup: do not log the same member more than once per 7 days.
  INSERT INTO flw_lifecycle_events (member_id, employee_code, event_type, detail)
  SELECT
    m.id,
    m.employee_code,
    'leaver_flagged',
    'FlowHCM shows employee as inactive/leaver'
      || COALESCE(' on ' || TO_CHAR(e.leaving_date, 'DD/MM/YYYY'), '')
      || '. App account still active. Review and deactivate manually if confirmed.'
  FROM members m
  JOIN flw_employees e ON e.employee_code = m.employee_code
  WHERE m.is_active
    AND NOT COALESCE(m.lifecycle_exempt, FALSE)
    AND e.is_active = FALSE
    AND NOT EXISTS (
      SELECT 1 FROM flw_lifecycle_events ev
      WHERE ev.member_id = m.id
        AND ev.event_type = 'leaver_flagged'
        AND ev.created_at > NOW() - INTERVAL '7 days'
    );

  -- ── Block 2: Exempt leaver logging ───────────────────────────────────────
  -- No action taken for lifecycle_exempt members. Log for visibility only.
  -- Dedup: once per 7 days.
  INSERT INTO flw_lifecycle_events (member_id, employee_code, event_type, detail)
  SELECT
    m.id,
    m.employee_code,
    'left_but_exempt',
    'FlowHCM shows employee as inactive but account is lifecycle-exempt — no action taken.'
  FROM members m
  JOIN flw_employees e ON e.employee_code = m.employee_code
  WHERE m.is_active
    AND COALESCE(m.lifecycle_exempt, FALSE)
    AND e.is_active = FALSE
    AND NOT EXISTS (
      SELECT 1 FROM flw_lifecycle_events ev
      WHERE ev.member_id = m.id
        AND ev.event_type = 'left_but_exempt'
        AND ev.created_at > NOW() - INTERVAL '7 days'
    );

  -- ── Block 3a: Unambiguous manager mismatch ───────────────────────────────
  -- LOG ONLY. Do NOT write to members.manager_id.
  -- If FlowHCM reports_to resolves to exactly one active member who differs
  -- from the app's current manager_id, log 'manager_mismatch' for admin review.
  -- manager_id_locked = true members are skipped entirely (intentional hierarchy).
  -- Dedup: do not log the same member more than once per 7 days.
  WITH resolution AS (
    SELECT
      m.id                AS member_id,
      m.employee_code,
      m.manager_id        AS app_mgr_id,
      e.reports_to,
      (
        SELECT MIN(m2.id::text)::uuid
        FROM flw_employees e2
        JOIN members m2 ON m2.employee_code = e2.employee_code AND m2.is_active
        WHERE e2.full_name = e.reports_to AND e2.is_active
      )                   AS flw_mgr_id,
      (
        SELECT COUNT(DISTINCT m2.id)
        FROM flw_employees e2
        JOIN members m2 ON m2.employee_code = e2.employee_code AND m2.is_active
        WHERE e2.full_name = e.reports_to AND e2.is_active
      )                   AS n_candidates,
      (
        SELECT mgr.name
        FROM members mgr
        WHERE mgr.id = m.manager_id
        LIMIT 1
      )                   AS app_mgr_name
    FROM members m
    JOIN flw_employees e ON e.employee_code = m.employee_code
    WHERE m.is_active
      AND e.is_active
      AND e.reports_to IS NOT NULL
      AND NOT COALESCE(m.manager_id_locked, FALSE)
  )
  INSERT INTO flw_lifecycle_events (member_id, employee_code, event_type, detail)
  SELECT
    r.member_id,
    r.employee_code,
    'manager_mismatch',
    'FlowHCM reports_to: "' || r.reports_to || '"'
      || ' · App manager: ' || COALESCE(r.app_mgr_name, '(none)')
      || ' · No change made — update manager manually in the app if correct.'
  FROM resolution r
  WHERE r.n_candidates = 1
    AND r.flw_mgr_id IS NOT NULL
    AND r.flw_mgr_id IS DISTINCT FROM r.app_mgr_id
    AND r.flw_mgr_id != r.member_id
    AND NOT EXISTS (
      SELECT 1 FROM flw_lifecycle_events ev
      WHERE ev.member_id = r.member_id
        AND ev.event_type = 'manager_mismatch'
        AND ev.created_at > NOW() - INTERVAL '7 days'
    );

  -- ── Block 3b: Ambiguous manager match ────────────────────────────────────
  -- LOG ONLY. No guess. No write to members.manager_id.
  -- Dedup: do not log the same member more than once per 7 days.
  WITH resolution AS (
    SELECT
      m.id                AS member_id,
      m.employee_code,
      e.reports_to,
      (
        SELECT COUNT(DISTINCT m2.id)
        FROM flw_employees e2
        JOIN members m2 ON m2.employee_code = e2.employee_code AND m2.is_active
        WHERE e2.full_name = e.reports_to AND e2.is_active
      )                   AS n_candidates
    FROM members m
    JOIN flw_employees e ON e.employee_code = m.employee_code
    WHERE m.is_active
      AND e.is_active
      AND e.reports_to IS NOT NULL
      AND NOT COALESCE(m.manager_id_locked, FALSE)
  )
  INSERT INTO flw_lifecycle_events (member_id, employee_code, event_type, detail)
  SELECT
    r.member_id,
    r.employee_code,
    'manager_ambiguous',
    'FlowHCM reports_to "' || r.reports_to || '" matches '
      || r.n_candidates || ' active members — cannot resolve. No change made.'
  FROM resolution r
  WHERE r.n_candidates > 1
    AND NOT EXISTS (
      SELECT 1 FROM flw_lifecycle_events ev
      WHERE ev.member_id = r.member_id
        AND ev.event_type = 'manager_ambiguous'
        AND ev.created_at > NOW() - INTERVAL '7 days'
    );

END;
$$;

-- ── Permissions ──────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.sync_member_lifecycle() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sync_member_lifecycle() TO service_role;
