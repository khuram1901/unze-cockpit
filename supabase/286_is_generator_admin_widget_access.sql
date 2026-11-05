-- Migration 286: Extend is_generator_admin() to include widget holders
-- Purpose: Anyone with admin_ops.generators widget enabled can now edit and
--          delete generator fuel/maintenance entries, same as CEO/Admin role.
--          Previously only CEO/Admin could edit — Managers were locked out.
--
-- Applied: 2026-11-05 via Supabase MCP
--
-- ROLLBACK:
--   CREATE OR REPLACE FUNCTION public.is_generator_admin()
--   RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
--     SELECT EXISTS (SELECT 1 FROM members m WHERE lower(m.email) = lower(auth.email()) AND m.role IN ('CEO','Admin'));
--   $$;

CREATE OR REPLACE FUNCTION public.is_generator_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM members m
    WHERE lower(m.email) = lower(auth.email())
    AND (
      m.role IN ('CEO', 'Admin')
      OR has_widget('admin_ops.generators')
    )
  );
$$;

SELECT 'is_generator_admin updated — widget holders can now edit entries' AS status;
