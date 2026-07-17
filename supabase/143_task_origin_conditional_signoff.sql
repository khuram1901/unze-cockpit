-- 143_task_origin_conditional_signoff.sql
--
-- Khuram (17/07/2026): "this only applies if the tasks was created by
-- their HOD/manager, via minutes of meeting or via Personal assistant.
-- otherwise all tasks created by themselves they can complete."
--
-- Today, the Submitted -> HOD "Mark Complete" gate (enforce_task_completion_hod,
-- migrations 114/115) and its automatic routing to the assignee's manager
-- (route_submitted_task, migrations 116/122) apply identically to every
-- task -- there's no concept of who actually created it. This adds a
-- requires_manager_signoff column, set once at creation time (see
-- createTaskCore in app/lib/task-creation.ts) and never recalculated
-- afterwards:
--   true  -- created by someone else for this assignee (a manager/HOD
--            assigning work), OR linked to a meeting (meeting_id), OR
--            explicitly flagged as created via the Personal Assistant
--   false -- the assignee created this task for themselves
--
-- Existing tasks are backfilled with the same rule, retroactively, per
-- Khuram's explicit call -- some tasks already sitting in Submitted,
-- created by their own assignee, become directly completable by that
-- assignee without waiting on a manager who never needed to be involved.

alter table public.tasks
  add column if not exists requires_manager_signoff boolean not null default true;

-- recurring_tasks has no record at all today of who actually set a
-- template up (assigned_by is a hardcoded literal "Recurring Template" on
-- every row, not the real creator) -- needed so the cron that spins out
-- each cycle's task instance (app/api/tasks/recurring/route.ts) can tell
-- whether a member built their own recurring template for themselves
-- (no sign-off needed on the tasks it produces) versus a manager building
-- one for someone else (sign-off needed). Existing templates predate this
-- column and stay null, which the cron treats as "needs sign-off" -- the
-- safe default, since we genuinely don't know who created them.
alter table public.recurring_tasks
  add column if not exists created_by_email text;

-- The backfill below touches every task row. Two things stand in the way
-- of a blanket UPDATE like that:
--   1. enforce_completed_task_lock (migration 117) unconditionally blocks
--      ANY update to an already-Completed task unless the actor is
--      admin-tier -- and the SQL Editor has no logged-in app user at all
--      (auth.email() is null here), so it rejects the whole statement
--      with "This task is completed and locked."
--   2. tasks_description_length_chk and tasks_assigned_by_email_chk are
--      both "NOT VALID" check constraints -- meaning some rows already in
--      the table predate them and don't actually satisfy them, but
--      Postgres re-checks every constraint on every row an UPDATE
--      touches regardless of which columns changed, so those legacy rows
--      block this statement too even though it never reads or writes
--      description/assigned_by_email's validity.
-- Disabling the trigger and dropping+re-adding the two constraints
-- (staying NOT VALID, so nothing about their normal enforcement changes)
-- for the duration of this one backfill statement, then restoring all
-- three immediately after, is safe -- it's a one-shot migration script,
-- not a standing change to any of these rules.
alter table public.tasks disable trigger tasks_enforce_completed_lock;
alter table public.tasks drop constraint if exists tasks_description_length_chk;
alter table public.tasks drop constraint if exists tasks_assigned_by_email_chk;

update public.tasks
set requires_manager_signoff = (
  meeting_id is not null
  or lower(coalesce(assigned_to_email, '')) is distinct from lower(coalesce(assigned_by_email, ''))
);

alter table public.tasks enable trigger tasks_enforce_completed_lock;
alter table public.tasks add constraint tasks_description_length_chk check (char_length(description) <= 150) not valid;
alter table public.tasks add constraint tasks_assigned_by_email_chk check (assigned_by_email is not null) not valid;

-- ── enforce_task_completion_hod(): branch on requires_manager_signoff ──
create or replace function public.enforce_task_completion_hod()
returns trigger as $$
declare
  actor_email text := auth.email();
  actor_role text := public.get_user_role();
begin
  if new.status = 'Completed' and (old.status is distinct from 'Completed') then

    if coalesce(new.requires_manager_signoff, true) = false then
      -- Self-created task: the assignee can close it directly, from any
      -- status, no Submitted step or manager sign-off required. Admin/
      -- CEO/Executive can still close anyone's, same as everywhere else.
      if actor_email is not null and new.assigned_to_email is not null
         and lower(actor_email) = lower(new.assigned_to_email) then
        return new;
      end if;
      if public.is_admin_tier() or actor_role = 'Executive' then
        return new;
      end if;
      raise exception 'Only the assignee (or Khuram, Kamran, or the Executive) can mark this task Completed.';
    end if;

    if old.status is distinct from 'Submitted' then
      raise exception 'A task can only be marked Completed once it has been Submitted for HOD sign-off.';
    end if;

    if actor_email is null or new.assigned_to_email is null then
      raise exception 'Cannot verify who is closing this task.';
    end if;

    if lower(actor_email) = lower(new.assigned_to_email) then
      return new;
    end if;

    if public.is_admin_tier() or actor_role = 'Executive' then
      return new;
    end if;

    raise exception 'Only the assigned HOD (or Khuram, Kamran, or the Executive) can mark a task Completed.';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- ── route_submitted_task(): never reassign a self-created task away from
-- its own creator/assignee -- they don't need (or want) a manager in the
-- loop at all, so "Submitted" is just a label for them, not a handoff.
create or replace function public.route_submitted_task()
returns trigger as $$
declare
  owner_role text;
  next_id uuid;
  candidate record;
  mgr record;
  hop int;
  original record;
begin
  if new.status = 'Submitted' and (old.status is distinct from 'Submitted') and coalesce(old.requires_manager_signoff, true) then
    if old.assigned_to_email is not null then
      select manager_id, role into next_id, owner_role
      from public.members where lower(email) = lower(old.assigned_to_email);

      if next_id is not null and owner_role is distinct from 'Executive' then
        mgr := null;
        hop := 0;
        while next_id is not null and hop < 10 loop
          hop := hop + 1;
          select id, name, email, department, business_unit, is_active, manager_id into candidate
          from public.members where id = next_id;

          if candidate.email is null then
            next_id := null;
          elsif candidate.is_active is distinct from false then
            mgr := candidate;
            next_id := null;
          else
            next_id := candidate.manager_id;
          end if;
        end loop;

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
