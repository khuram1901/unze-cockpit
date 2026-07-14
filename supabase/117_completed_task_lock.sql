-- Migration 117: A Completed task is locked — only an admin can edit or reopen it
--
-- Khuram: "once the task is completed then it should be greyed out. I
-- dont think the task should be allowed to be edited afterwards, so the
-- cycle is complete, then it should dissapear, unless the administration
-- who has the rights to bring it back." The app now greys out and
-- disables every editable field on a Completed task in TaskStatus.tsx and
-- TaskDetailPanel.tsx unless the viewer is Admin-tier
-- (canReopenCompletedTask in lib/permissions.ts) — but that's a client
-- check, easily bypassed by anyone hitting the table directly. This is
-- the real, unbypassable version, same pattern as the HOD-completion
-- gate (migrations 114/115) and the subtask gate (migration 100).
--
-- Also closes a gap those two migrations didn't cover: 114/115 only ever
-- gated the FORWARD move into Completed — nothing stopped a task from
-- being reopened (or edited in any way) again afterwards. This trigger
-- blocks ANY update to a row that is currently Completed, full stop,
-- unless the person making the change is Admin-tier (is_admin_tier() —
-- Khuram, Kamran, or role Admin; deliberately narrower than "privileged",
-- since Khuram's wording here was "the administration", not the
-- Executive).
--
-- Note: this is a hard lock at the row level — it will also block any
-- future automated process (a cron job, an API route, a bulk import)
-- that tries to touch an already-Completed row unless it runs as an
-- admin-tier user. Nothing in the app currently does that, but flag it
-- to Khuram if a new feature ever needs to touch closed tasks.
--
-- Apply via Supabase SQL Editor, after 116.

begin;

create or replace function public.enforce_completed_task_lock()
returns trigger as $$
begin
  if old.status = 'Completed' and not public.is_admin_tier() then
    raise exception 'This task is completed and locked. Only an admin can edit or reopen it.';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists tasks_enforce_completed_lock on public.tasks;
create trigger tasks_enforce_completed_lock
  before update on public.tasks
  for each row execute function public.enforce_completed_task_lock();

commit;
