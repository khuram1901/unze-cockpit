-- Migration 119: A task cannot be INSERTed already Completed
--
-- Found during the 15 Jul 2026 full-app audit: NewTaskForm.tsx offered
-- "Completed" as a starting status, and createTaskCore() inserted
-- whatever status was given with no check. Every safety net built so
-- far (migrations 114, 115, 117) is a BEFORE UPDATE trigger — none of
-- them fire on INSERT — so anyone with task-creation rights could hand
-- themselves a pre-closed task and skip HOD review (Submitted -> "Mark
-- Complete") entirely. The app-side fix (removing "Completed" from
-- NewTaskForm's dropdown, and createTaskCore rejecting it) is now in
-- app/tasks/NewTaskForm.tsx and app/lib/task-creation.ts. This is the
-- unbypassable database-level version, same pattern as 114/115/117.
--
-- Reuses the existing enforce_completed_task_lock() function (117) by
-- extending it to also run BEFORE INSERT and check the incoming row,
-- rather than adding a second, separate function.
--
-- Apply via Supabase SQL Editor, after 118.

begin;

create or replace function public.enforce_completed_task_lock()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'Completed' and not public.is_admin_tier() then
      raise exception 'A task cannot be created already Completed. It must go through Submitted and HOD sign-off first.';
    end if;
    return new;
  end if;

  if old.status = 'Completed' and not public.is_admin_tier() then
    raise exception 'This task is completed and locked. Only an admin can edit or reopen it.';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists tasks_enforce_completed_lock on public.tasks;
create trigger tasks_enforce_completed_lock
  before insert or update on public.tasks
  for each row execute function public.enforce_completed_task_lock();

commit;
