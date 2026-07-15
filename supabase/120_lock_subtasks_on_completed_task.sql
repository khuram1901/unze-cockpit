-- Migration 120: Subtasks are locked once their parent task is Completed
--
-- Found during the 15 Jul 2026 full-app audit: migration 117 locks the
-- `tasks` table itself once Completed, but not `task_subtasks` — the
-- quick inline checklist (MiniSubtaskToggle.tsx) had no lock check at
-- all client-side either (now fixed separately), and there was no
-- database backstop for this table the way there is for `tasks`. This
-- closes that gap: any INSERT/UPDATE/DELETE against a subtask whose
-- parent task is Completed is blocked unless the actor is admin-tier,
-- same rule as 117, same is_admin_tier() check.
--
-- Apply via Supabase SQL Editor, after 119.

begin;

create or replace function public.enforce_completed_task_subtask_lock()
returns trigger as $$
declare
  parent_status text;
  parent_task_id uuid;
begin
  parent_task_id := coalesce(new.task_id, old.task_id);
  select status into parent_status from public.tasks where id = parent_task_id;

  if parent_status = 'Completed' and not public.is_admin_tier() then
    raise exception 'This task is completed and locked. Only an admin can edit its subtasks.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists task_subtasks_enforce_completed_lock on public.task_subtasks;
create trigger task_subtasks_enforce_completed_lock
  before insert or update or delete on public.task_subtasks
  for each row execute function public.enforce_completed_task_subtask_lock();

commit;
