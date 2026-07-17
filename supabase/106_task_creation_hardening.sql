-- Migration 106: Task-creation consolidation — safety net + recurring company tag
--
-- Part of the task-creation/notification cleanup agreed with Khuram on
-- 14/07/2026 (see TASK_NOTIFICATION_AUDIT.md). Two additive changes:
--
--   1. company_id on recurring_tasks — templates can now carry their own
--      company, same as regular tasks. Left NULLABLE deliberately: none
--      of the 8 currently-active templates have one set (Bilal follow-up,
--      Stock Sheet, Transworld Bill, a few fee/hostel-fee challans, etc.)
--      — several of these look personal rather than tied to
--      UTPL/IFPL/Baranh/Haute Dolci. Khuram needs to review and set (or
--      deliberately decide these are exempt) before the recurring cron
--      starts requiring a company the same way every other task-creation
--      path now does — see the flag raised alongside this migration.
--
--   2. Two NOT VALID check constraints on tasks, as a database-level
--      backstop behind the new shared /api/tasks/create route:
--        - description must be 150 characters or fewer (matches
--          TASK_DESCRIPTION_LIMIT in SharedUI.tsx)
--        - assigned_by_email must not be null
--      NOT VALID means existing rows are grandfathered in — 10 tasks
--      today already exceed 150 characters (they predate the character-
--      limit rule added in an earlier session) and would fail a normal
--      validated CHECK. With NOT VALID, the constraint only bites on new
--      inserts/updates from this point forward. Existing assigned_by_email
--      values are all already non-null, so that one costs nothing today.
--      Run `VALIDATE CONSTRAINT` later if the old long-description rows
--      get cleaned up and you want full enforcement.
--
-- Apply via Supabase SQL Editor, after 098-105.

begin;

alter table public.recurring_tasks
  add column if not exists company_id uuid references public.companies(id);

alter table public.tasks
  drop constraint if exists tasks_description_length_chk;
alter table public.tasks
  add constraint tasks_description_length_chk
  check (char_length(description) <= 150) not valid;

alter table public.tasks
  drop constraint if exists tasks_assigned_by_email_chk;
alter table public.tasks
  add constraint tasks_assigned_by_email_chk
  check (assigned_by_email is not null) not valid;

commit;
