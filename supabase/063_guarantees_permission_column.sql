-- Migration 063: Add can_view_guarantees column to member_permissions
-- Apply manually via Supabase SQL Editor.

alter table member_permissions
  add column if not exists can_view_guarantees boolean default null;
