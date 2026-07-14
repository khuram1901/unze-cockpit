-- Migration 115: Khuram, Kamran, and the Executive can close ANY task
--
-- Fixes migration 114, which was too narrow. It let the Executive close a
-- task only when it had landed with Khuram or Kamran specifically. In
-- practice Khuram hit this immediately: he tried to bulk-complete a task
-- assigned to Sania Saleem (routed to her own department HOD, not to
-- Khuram/Kamran) and was correctly blocked by that version of the rule —
-- but that's not what he wants. His words: "i thought i can close any
-- tasks, complete any task. You must allow me, sundus and Kamran to do
-- this." So the rule is now: the task's current owner may always close
-- their own (once Submitted) — that's the ordinary HOD case — and Khuram,
-- Kamran, and the Executive (Sundas) may close ANY Submitted task, full
-- stop, as a blanket override rather than one scoped to whose queue it's
-- in. Matches the app-side fix in lib/permissions.ts
-- (canCompleteSubmittedTask now uses isPrivileged() — Admin-tier or
-- Executive — instead of the narrower per-assignee check).
--
-- Apply via Supabase SQL Editor, after 114 (safe to run even if 114 was
-- never applied — this recreates the same trigger from scratch).

begin;

create or replace function public.enforce_task_completion_hod()
returns trigger as $$
declare
  actor_email text := auth.email();
  actor_role text := public.get_user_role();
begin
  if new.status = 'Completed' and (old.status is distinct from 'Completed') then

    if old.status is distinct from 'Submitted' then
      raise exception 'A task can only be marked Completed once it has been Submitted for HOD sign-off.';
    end if;

    if actor_email is null or new.assigned_to_email is null then
      raise exception 'Cannot verify who is closing this task.';
    end if;

    -- The task's current owner: their real HOD once Submitted-routing has
    -- happened, or themself for top-of-chain / Executive-owned tasks.
    if lower(actor_email) = lower(new.assigned_to_email) then
      return new;
    end if;

    -- Blanket override: Khuram, Kamran (is_admin_tier — role='Admin' or
    -- the two named emails), or the Executive (Sundas) may close anyone's
    -- Submitted task, not just ones that happened to route to them.
    if public.is_admin_tier() or actor_role = 'Executive' then
      return new;
    end if;

    raise exception 'Only the assigned HOD (or Khuram, Kamran, or the Executive) can mark a task Completed.';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists tasks_enforce_completion_hod on public.tasks;
create trigger tasks_enforce_completion_hod
  before update on public.tasks
  for each row execute function public.enforce_task_completion_hod();

commit;
