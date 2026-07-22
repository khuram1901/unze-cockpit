-- Migration 189: Waiting Reply routing
--
-- Adds the fields needed for the "Reply & Return" workflow:
--
-- When someone sets a task to "Waiting Reply" they can:
--   a) Tag a specific person whose reply they need (waiting_reply_to_email/name)
--   b) Leave blank → the system routes to their reporting-line manager
--
-- The task is then reassigned to that person (same mechanism as Submitted
-- routing). These columns track who was waiting and the question they asked,
-- so the reply-to person sees context and can hand the task back.
--
-- waiting_reply_note       — the question / blocker description from the asker
-- waiting_reply_to_email   — explicitly tagged reply-to person (optional)
-- waiting_reply_to_name    — their display name
-- waiting_reply_by_email   — the person who set "Waiting Reply" (to return to)
-- waiting_reply_by_name    — their display name
-- manager_reply_text       — the reply written by the reply-to person
-- manager_reply_at         — when the reply was given
--
-- Apply manually via Supabase SQL Editor.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS waiting_reply_note      TEXT,
  ADD COLUMN IF NOT EXISTS waiting_reply_to_email  TEXT,
  ADD COLUMN IF NOT EXISTS waiting_reply_to_name   TEXT,
  ADD COLUMN IF NOT EXISTS waiting_reply_by_email  TEXT,
  ADD COLUMN IF NOT EXISTS waiting_reply_by_name   TEXT,
  ADD COLUMN IF NOT EXISTS manager_reply_text      TEXT,
  ADD COLUMN IF NOT EXISTS manager_reply_at        TIMESTAMPTZ;
