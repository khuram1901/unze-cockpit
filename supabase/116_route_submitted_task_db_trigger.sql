-- Migration 116: DB-level safety net — "Submitted" always routes to the HOD
--
-- Khuram: "can you just [check on] the ruling of submitted, it should be
-- now showing up on the HOD's task list to review and complete. Please
-- ensure this is working." Investigating found the reassignment logic
-- (move the task to the current owner's manager once it's Submitted)
-- lived ONLY inside TaskStatus.tsx's status dropdown. The bulk "Change
-- status" dropdown (TasksList.tsx) and the Kanban board's drag-and-drop
-- (TasksBoard.tsx) both did a raw status UPDATE with no reassignment, so
-- a task submitted through either of those stayed with the original
-- assignee and never actually reached the manager's own My Tasks.
--
-- The app-side gaps are patched (new app/lib/taskRouting.ts, shared by
-- TaskStatus.tsx, TasksList.tsx, and TasksBoard.tsx), but per the same
-- "airtight" bar Khuram set for the HOD-completion rule (migrations
-- 114/115), this mirrors that same logic at the database level so it
-- holds no matter which screen — present or future — changes the status.
--
-- Forward direction: whenever status flips TO 'Submitted' from something
-- else, looks up OLD.assigned_to_email's manager and reassigns
-- NEW.assigned_to/assigned_to_email/department/business_unit to them,
-- recording who it came from in submitted_by_name/email (migration 113's
-- columns). No-op if the current owner has no manager on file or is the
-- Executive — same carve-outs as the app-side routeSubmittedTask().
--
-- Reverse direction (hand-back): if a Submitted task moves to anything
-- other than Submitted/Completed/Cancelled, it's handed back to whoever
-- it was submitted by.
--
-- Both directions also run whenever the app-side code already did this
-- itself (e.g. TaskStatus.tsx sends the reassignment fields in the same
-- UPDATE) — harmless: the trigger always recomputes from OLD, so it just
-- confirms the same values rather than double-hopping to the manager's
-- own manager.
--
-- Apply via Supabase SQL Editor, after 115.

begin;

create or replace function public.route_submitted_task()
returns trigger as $$
declare
  owner_role text;
  owner_manager_id uuid;
  mgr record;
  original record;
begin
  if new.status = 'Submitted' and (old.status is distinct from 'Submitted') then
    if old.assigned_to_email is not null then
      select manager_id, role into owner_manager_id, owner_role
      from public.members where lower(email) = lower(old.assigned_to_email);

      if owner_manager_id is not null and owner_role is distinct from 'Executive' then
        select id, name, email, department, business_unit into mgr
        from public.members where id = owner_manager_id;

        if mgr.email is not null then
          delete from public.task_assignees where task_id = new.id;
          insert into public.task_assignees (task_id, member_id, member_name, member_email)
            values (new.id, mgr.id, mgr.name, mgr.email);

          new.assigned_to := mgr.name;
          new.assigned_to_email := mgr.email;
          new.assigned_to_department := mgr.department;
          new.assigned_to_business_unit := mgr.business_unit;
          new.submitted_by_name := old.assigned_to;
          new.submitted_by_email := old.assigned_to_email;
        end if;
      end if;
    end if;
  end if;

  if old.status = 'Submitted' and (new.status is distinct from 'Submitted') and old.submitted_by_email is not null then
    if new.status in ('Completed', 'Cancelled') then
      new.submitted_by_name := null;
      new.submitted_by_email := null;
    else
      select id, name, email, department, business_unit into original
      from public.members where lower(email) = lower(old.submitted_by_email);

      if original.email is not null then
        delete from public.task_assignees where task_id = new.id;
        insert into public.task_assignees (task_id, member_id, member_name, member_email)
          values (new.id, original.id, original.name, original.email);

        new.assigned_to := original.name;
        new.assigned_to_email := original.email;
        new.assigned_to_department := original.department;
        new.assigned_to_business_unit := original.business_unit;
      end if;
      new.submitted_by_name := null;
      new.submitted_by_email := null;
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists tasks_route_submitted on public.tasks;
create trigger tasks_route_submitted
  before update on public.tasks
  for each row execute function public.route_submitted_task();

commit;
