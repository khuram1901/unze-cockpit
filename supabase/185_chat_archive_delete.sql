-- Migration 185 — Chat archive and delete (per-participant)
-- Apply via Supabase SQL Editor.
-- Already applied directly via Supabase MCP — this file is the record.
--
-- Changes:
--   chat_participants.is_archived  — hides from main list, recoverable
--   chat_participants.is_deleted   — removes from user's view entirely
--   get_my_conversations updated to filter by these flags
--   (see MCP execution in session notes)

ALTER TABLE chat_participants
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_deleted  boolean NOT NULL DEFAULT false;
