-- Migration 188: Task creation open to all — Access Matrix is the sole gate
--
-- Previously, can_create_tasks defaulted to false for all Members and most Managers.
-- The new rule: everyone can create tasks by default; revoke explicitly via the
-- Access Matrix for any individual you don't want creating tasks.
--
-- This migration resets the column to NULL for all existing members so they
-- inherit the new default (true) from the permission function.
-- Admins and CEOs never have a member_permissions row so are unaffected.

UPDATE member_permissions
SET can_create_tasks = NULL;

-- Apply manually via Supabase SQL Editor — never auto-run.
