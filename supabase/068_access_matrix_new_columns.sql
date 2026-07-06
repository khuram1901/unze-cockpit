-- 068_access_matrix_new_columns.sql
-- Adds five new permission columns to member_permissions so the
-- Access Matrix toggles can store per-member overrides.
--
-- Apply manually in Supabase SQL Editor.

ALTER TABLE member_permissions
  ADD COLUMN IF NOT EXISTS can_view_guarantees   boolean DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS can_manage_guarantees boolean DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS can_view_stock        boolean DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS can_manage_stock      boolean DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS can_manage_meetings   boolean DEFAULT NULL;
