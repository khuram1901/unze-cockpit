-- 173_hr_td_feedback_window.sql
-- Adds a feedback_close_date to hr_td_sessions.
-- When a session is marked Completed, the app sets this to session_date + 7 days
-- (or HR can override it). The sync route only processes sessions within this window.
-- Apply via Supabase SQL Editor.

ALTER TABLE hr_td_sessions
  ADD COLUMN IF NOT EXISTS feedback_close_date date;

COMMENT ON COLUMN hr_td_sessions.feedback_close_date IS
  'Last date on which feedback will be synced from Google Forms. Set automatically to session_date + 7 days when marked Completed. HR can override.';
