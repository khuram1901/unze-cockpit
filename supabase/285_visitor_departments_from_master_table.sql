-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 285 — visitor_departments_hosts: use master departments table
--
-- Previously this RPC pulled the department list from a UNION of visitor_log
-- and members, meaning only departments that had ever had a visitor OR had an
-- active member would appear. This was inconsistent with the rest of the app
-- (Tasks and Members both use the canonical `departments` table).
--
-- Fix: source departments from the `departments` table (active = true).
-- The hosts list (active members) is unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.visitor_departments_hosts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_depts jsonb;
  v_hosts jsonb;
BEGIN
  -- All active departments from the master departments table
  -- (same source used by Tasks and Members pages)
  SELECT jsonb_agg(d ORDER BY d)
  INTO v_depts
  FROM (
    SELECT department_name AS d
    FROM departments
    WHERE active = true
      AND department_name IS NOT NULL
      AND department_name <> ''
  ) q;

  -- Active members as hosts (unchanged)
  SELECT jsonb_agg(r ORDER BY r.full_name)
  INTO v_hosts
  FROM (
    SELECT id::text, name AS full_name, department
    FROM members
    WHERE is_active = true AND name IS NOT NULL
  ) r;

  RETURN jsonb_build_object(
    'departments', COALESCE(v_depts, '[]'::jsonb),
    'hosts',       COALESCE(v_hosts, '[]'::jsonb)
  );
END;
$$;
