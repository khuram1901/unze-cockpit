-- Migration 113: "Submitted" auto-routes to the submitter's manager
--
-- Khuram, from earlier this session: "every time a task is submitted, it
-- should go to their HOD... it should now become part of their task to
-- review the work and complete the task." Deliberately deferred until the
-- org structure (manager_id/HOD chain, migrations 109-111) existed and was
-- populated enough to route through. Checked the live data before building
-- this: 10 of 15 active people already have a manager set; the remaining 4
-- HODs (Akhlaq/Admin, M. Nadeem/IT, Naseem/Accounts, Zuhair/HR) had none —
-- Khuram confirmed pointing them to himself for now, as a one-row data fix
-- (not a schema change), same treatment as the Yahya Saleem HOD-conflict
-- fix in migration 109's session.
--
-- These two columns remember who the task belonged to right before it got
-- reassigned to the manager, so it can be handed back automatically when
-- the manager sends it anywhere other than Completed/Cancelled — see the
-- app-side logic in TaskStatus.tsx (saveStatus/submitExplanation).
--
-- Apply via Supabase SQL Editor, after 112.

begin;

alter table public.tasks
  add column if not exists submitted_by_name text,
  add column if not exists submitted_by_email text;

commit;
