-- Migration 033: Allow every user to read their own permission row
--
-- The existing "permissions_admin" policy uses FOR ALL with is_admin_tier(),
-- which blocks non-admin users from reading their own overrides.
-- This breaks the sidebar and route guards for non-admin users.
--
-- Fix: replace the single FOR ALL policy with separate policies:
--   - SELECT: own row OR admin tier
--   - INSERT/UPDATE/DELETE: admin tier only

-- Drop the old combined policy
DROP POLICY IF EXISTS "permissions_admin" ON member_permissions;

-- Everyone can read their own row; admin tier can read all
CREATE POLICY "permissions_select" ON member_permissions FOR SELECT
  USING (
    member_id = (SELECT id FROM members WHERE email = auth.email() LIMIT 1)
    OR is_admin_tier()
  );

-- Only admin tier can modify permissions
CREATE POLICY "permissions_insert" ON member_permissions FOR INSERT
  WITH CHECK (is_admin_tier());

CREATE POLICY "permissions_update" ON member_permissions FOR UPDATE
  USING (is_admin_tier()) WITH CHECK (is_admin_tier());

CREATE POLICY "permissions_delete" ON member_permissions FOR DELETE
  USING (is_admin_tier());
