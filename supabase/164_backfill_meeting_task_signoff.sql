-- 164_backfill_meeting_task_signoff.sql
--
-- Backfill: any task created from a meeting (meeting_id IS NOT NULL) that
-- somehow has requires_manager_signoff = false or NULL gets corrected to
-- true.  This closes the gap where old tasks were created before the
-- defaulting logic in task-creation.ts was tightened, letting assignees
-- mark them Completed without HOD sign-off.
--
-- Safe to run multiple times (idempotent — only touches rows that need it).
-- Apply via Supabase SQL Editor.

update public.tasks
set
  requires_manager_signoff = true,
  updated_at = now()
where
  meeting_id is not null
  and (requires_manager_signoff is null or requires_manager_signoff = false)
  and status not in ('Completed', 'Cancelled');

-- How many rows were affected will show in the SQL Editor result.
