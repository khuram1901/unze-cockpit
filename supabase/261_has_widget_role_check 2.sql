-- =============================================================================
-- Migration 261: has_widget() — honour admin-tier role
-- Applied: MANUALLY via Supabase SQL Editor
-- Author: Claude (session 2026-10-08)
--
-- Problem: has_widget() only checked member_widget_overrides.
--   CEO / Admin users always got false unless an explicit override row existed.
--   This broke the Retail Sales tab for Khuram (CEO).
--
-- Fix: Return true when the authenticated member's role is CEO or Admin,
--   OR when an explicit visible=true override row exists.
--
-- Rollback (copy original from 254_retail_stores.sql):
-- CREATE OR REPLACE FUNCTION public.has_widget(p_widget_key text)
--  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
-- AS $$ SELECT EXISTS (
--   SELECT 1 FROM public.member_widget_overrides mwo
--   JOIN public.members m ON m.id = mwo.member_id
--   WHERE lower(m.email) = lower(auth.email())
--     AND mwo.widget_key = p_widget_key AND mwo.visible = true
-- ) $$;
-- =============================================================================

CREATE OR REPLACE FUNCTION public.has_widget(p_widget_key text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  -- Admin-tier (CEO, Admin) see all widgets by role — no override rows needed
  SELECT EXISTS (
    SELECT 1
    FROM public.members m
    WHERE lower(m.email) = lower(auth.email())
      AND m.role IN ('CEO', 'Admin')
  )
  OR
  -- Explicit override: visible = true
  EXISTS (
    SELECT 1
    FROM public.member_widget_overrides mwo
    JOIN public.members m ON m.id = mwo.member_id
    WHERE lower(m.email) = lower(auth.email())
      AND mwo.widget_key = p_widget_key
      AND mwo.visible = true
  );
$$;
