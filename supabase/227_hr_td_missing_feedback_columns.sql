-- Phase 4 drift fix: migrations 171/173 defined these columns but they were
-- never applied to the live hr_td_sessions table, so the T&D feedback sync
-- route (filters on feedback_sheet_id) has been failing.
-- Applied via Supabase MCP 30/08/2026.
alter table public.hr_td_sessions
  add column if not exists feedback_sheet_id   text,
  add column if not exists feedback_synced_at  timestamptz,
  add column if not exists feedback_close_date date;

comment on column public.hr_td_sessions.feedback_close_date is
  'Last date on which feedback will be synced from Google Forms. Set automatically to session_date + 7 days when marked Completed. HR can override.';
