-- Migration 114: Only the HOD (or Executive delegate) can close a task
--
-- Khuram: "no task can be completed until its submitted to their HOD and
-- only HOD can mark the task completed. This is very important." Then,
-- clarified: "Myself and Kamran are at the top of the food chain, All
-- people reporting to us, we are the only ones to complete their task, Or
-- we will allow our Executive to check and complete the task status.
-- Executive's tasks can be completed by themselves. rest of the members
-- submit their tasks, only their HOD completes the tasks." Followed by:
-- "it really doesnt matter if the sub tasks are completed by the users,
-- as long as the main task is closed by their hod, so please ensure this
-- is airtight" — this migration is that: the app (TaskStatus.tsx,
-- TasksList.tsx bulk actions, TasksBoard.tsx drag-drop) already gates
-- this client-side via canCompleteSubmittedTask() in lib/permissions.ts,
-- but a client-side check can't stop someone hitting the API/DB directly.
-- This trigger is the real, unbypassable version — same pattern as the
-- existing subtask-completion gate (migration 100), which is why Khuram
-- was told that one was DB-enforced and this one, until now, wasn't.
--
-- Rule enforced on every UPDATE of tasks, regardless of caller (browser
-- anon-key client OR a service-role API route — triggers fire either
-- way, unlike RLS which the service role bypasses):
--   1. status may only become 'Completed' by moving FROM 'Submitted'.
--      No jumping straight there from Not Started/In Progress/etc.
--   2. The person making the change must be either:
--      a) the task's current owner (assigned_to_email) — since
--         submitting a task already reassigns it to the assignee's
--         manager (app-side routeSubmittedTask), the current owner at
--         this point is genuinely their HOD, or the assignee themself
--         for top-of-chain people / the Executive (who close their own
--         directly, no further routing — see routeSubmittedTask's
--         Executive carve-out)
--      b) the Executive (PA), when the task landed with Khuram or
--         Kamran specifically — the delegated "check and complete"
--         Khuram described.
--
-- Apply via Supabase SQL Editor, after 113.

begin;

-- Mirrors is_admin_tier()'s definition (027_role_model.sql) but for an
-- arbitrary target email rather than the current session — needed here
-- because the trigger has to ask "is the task's ASSIGNEE top-tier",
-- not "is the person acting right now top-tier" (that's auth.email()
-- directly, no helper needed).
create or replace function public.is_admin_tier_email(target_email text)
returns boolean as $$
  select
    lower(coalesce(target_email, '')) in ('k.saleem@unzegroup.com', 'khuram1901@gmail.com')
    or exists (
      select 1 from public.members
      where lower(email) = lower(coalesce(target_email, '')) and role = 'Admin'
    );
$$ language sql security definer stable set search_path = public;

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

    -- The Executive checking/closing on Khuram or Kamran's behalf.
    if actor_role = 'Executive' and public.is_admin_tier_email(new.assigned_to_email) then
      return new;
    end if;

    raise exception 'Only the assigned HOD (or the Executive, for Khuram/Kamran''s queue) can mark a task Completed.';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists tasks_enforce_completion_hod on public.tasks;
create trigger tasks_enforce_completion_hod
  before update on public.tasks
  for each row execute function public.enforce_task_completion_hod();

commit;
