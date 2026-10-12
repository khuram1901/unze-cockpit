-- Migration 263: Add notif_task_comment preference to members
-- Apply via Supabase SQL Editor — never auto-run.
-- Adds a per-member toggle for task-comment email notifications.
-- Defaults to TRUE so all existing members receive comment emails
-- unless they opt out from their profile page.

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS notif_task_comment boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN members.notif_task_comment IS
  'When true, member receives an email whenever a comment is added to a task they are involved in (as assigner, assignee, or co-assignee). Controlled from the member profile page.';
