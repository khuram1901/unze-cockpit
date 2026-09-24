-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 236: FlowHCM lifecycle lockdown — sync_member_lifecycle() log-only
-- ─────────────────────────────────────────────────────────────────────────────
-- PURPOSE
-- -------
-- FlowHCM is now identity-only for the app. It may only inform; it may NOT act.
--
-- The ONLY field FlowHCM is permitted to write to `members` is `name`
-- (via sync_member_names_from_flw, migration 232).
--
-- This migration replaces sync_member_lifecycle() so that:
--   - FlowHCM leaver status  → logged as 'leaver_flagged' only.
--                               members.is_active is NEVER changed automatically.
--   - FlowHCM manager diffs  → logged as 'manager_mismatch' or 'manager_ambiguous'.
--                               members.manager_id is NEVER changed automatically.
--
-- FIELDS THAT FLOWHCM MUST NEVER WRITE TO `members` (enforced by this function):
--   company_id, company, department, department_id, role, manager_id, is_hod,
--   permissions, member_permissions, business_unit, any visibility/access fields,
--   is_active.
--
-- The app is the source of truth for hierarchy, company, role, and access.
-- FlowHCM is the source of truth for identity (name, employee code) only.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sync_member_lifecycle()
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
  -- No change from migration 218 — already log-only.
  -- Members with lifecycle_exempt = true who appear as inactive in FlowHCM.
  -- Logged for visibility only. No action taken. Dedup: once per 7 days.
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
  --
  -- manager_id_locked = true → member is intentionally app-managed.
  -- Skip mismatch logging for these members entirely.
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
      AND NOT COALESCE(m.manager_id_locked, FALSE)  -- skip locked/intentional hierarchy
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
    AND r.flw_mgr_id != r.member_id   -- guard against self-as-manager
    AND NOT EXISTS (
      SELECT 1 FROM flw_lifecycle_events ev
      WHERE ev.member_id = r.member_id
        AND ev.event_type = 'manager_mismatch'
        AND ev.created_at > NOW() - INTERVAL '7 days'
    );

  -- ── Block 3b: Ambiguous manager match ────────────────────────────────────
  -- LOG ONLY. FlowHCM reports_to name matches more than one active member.
  -- No guess is made. No write to members.manager_id.
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
      AND NOT COALESCE(m.manager_id_locked, FALSE)  -- skip locked/intentional hierarchy
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
-- Only service_role (Vercel cron / admin server calls) may invoke this function.
-- No client, anon, or authenticated user should ever call it directly.
REVOKE EXECUTE ON FUNCTION sync_member_lifecycle() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION sync_member_lifecycle() TO service_role;
