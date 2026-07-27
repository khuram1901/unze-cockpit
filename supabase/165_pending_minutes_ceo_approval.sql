-- 165_pending_minutes_ceo_approval.sql
--
-- Adds CEO approval step to the meeting minutes workflow.
--
-- New status flow:
--   pending → (PA reviews) → pa_approved → (CEO reviews) → approved
--                          ↘ dismissed (rejected at any stage)
--
-- New columns:
--   source_type     — how the minutes were produced; drives whether AI
--                     rewrites the content or just extracts fields:
--                       'claude'   = produced by Claude (skip rewrite)
--                       'other_ai' = ChatGPT, Letterly, etc. (skip rewrite)
--                       'raw'      = raw transcription (full AI rewrite)
--   extracted_data  — the structured meeting JSON saved by the PA after
--                     extraction, so the CEO sees the same data without
--                     needing to re-run the AI extraction step.
--   pa_approved_by  — email of the PA who submitted for CEO review
--   pa_approved_at  — when the PA submitted it
--
-- Apply via Supabase SQL Editor. Safe to run multiple times.

alter table public.pending_minutes
  add column if not exists source_type      text,
  add column if not exists extracted_data   jsonb,
  add column if not exists pa_approved_by   text,
  add column if not exists pa_approved_at   timestamptz;

-- Add a check constraint so only valid source types are stored.
-- Drop first in case it already exists from a partial run.
alter table public.pending_minutes
  drop constraint if exists pending_minutes_source_type_check;

alter table public.pending_minutes
  add constraint pending_minutes_source_type_check
  check (source_type is null or source_type in ('claude', 'other_ai', 'raw'));
