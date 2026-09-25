-- Migration 249: Fix subtask visibility for main-task co-assignees
--
-- Bug introduced by the ordering of migrations 100 and 112:
--
--   Migration 100 created task_subtasks_select, which grants subtask
--   visibility to the primary assignee (assigned_to_email) and task
--   creator (via assigned_by name match), plus admin-tier.
--
--   Migration 112 added the task_assignees join table and co-assignee
--   support, extending tasks_select and tasks_update to include
--   is_task_assignee(). However, task_subtasks_select was never updated
--   to match — leaving co-assignees able to see the parent task but
--   silently blocked from its subtasks by RLS.
--
-- Fix: add OR is_task_assignee(t.id) to task_subtasks_select.
-- This mirrors exactly what migration 112 did to tasks_select.
--
-- Scope: READ ONLY. No write access is changed. No schema changes.
-- No new tables. No new functions. No data modifications.
-- The write policy (task_subtasks_write) is intentionally unchanged.
--
-- Safe to roll back by reverting to the migration 100 version of this
-- policy (remove the is_task_assignee line).
--
-- Apply via Supabase SQL Editor, after 248.

begin;

drop policy if exists "task_subtasks_select" on public.task_subtasks;
create policy "task_subtasks_select" on public.task_subtasks
  for select using (
    exists (
      select 1 from public.tasks t
      where t.id = task_subtasks.task_id
        and (
          can_access_all_tasks()
          or t.assigned_to_email = (select auth.email())
          or t.assigned_by = (select m.name from public.members m where m.email = (select auth.email()))
          or is_task_assignee(t.id)
        )
    )
  );

commit;
