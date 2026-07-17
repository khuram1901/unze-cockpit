-- Migration 111: Leaver / offboarding support
--
-- Follows on from 109/110's manager_id chain. Khuram asked whether the
-- Reassign Tasks tool was now redundant given the org chart, and separately
-- asked to map a departure across everything a person is linked to (tasks,
-- direct reports, department ownership) rather than just their org-chart
-- position, in one action, without waiting on manual per-place cleanup.
--
-- Decision (confirmed with Khuram):
--   - No replacement lined up yet -> tasks and direct reports auto-route to
--     the leaver's own manager as interim cover.
--   - Reassign Tasks tab is replaced by a single "Offboard" action that does
--     tasks + reports + department ownership together.
--   - Leavers are archived, not deleted: is_active = false removes them
--     from every picker/dropdown app-wide, but their name stays intact on
--     old tasks, minutes, and reports so history doesn't break.
--
-- Apply via Supabase SQL Editor, after 109 and 110.

begin;

alter table public.members
  add column if not exists is_active boolean not null default true;

create index if not exists members_is_active_idx on public.members (is_active);

commit;
