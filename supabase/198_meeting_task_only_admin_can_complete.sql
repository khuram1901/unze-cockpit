-- 198_meeting_task_only_admin_can_complete.sql
--
-- Khuram (27/07/2026): Meeting tasks (those linked to a meeting via
-- meeting_id) must ONLY be completable by Admin/CEO/Executive — never by
-- the manager they were routed to.
--
-- The existing trigger (migration 143) already requires manager sign-off
-- for these tasks, but its completion check is:
--   "if actor = assigned_to_email → allow"
-- After Submit routing, the manager becomes assigned_to_email, so the
-- trigger was allowing managers to mark meeting tasks Complete themselves.
--
-- This patch adds one extra guard inside enforce_task_completion_hod():
-- if the task has a meeting_id set, only admin-tier or Executive can
-- mark it Completed, regardless of who assigned_to_email is.

create or replace function public.enforce_task_completion_hod()
returns trigger as $$
declare
  actor_email text := auth.email();
  actor_role text := public.get_user_role();
begin
  if new.status = 'Completed' and (old.status is distinct from 'Completed') then

    if coalesce(new.requires_manager_signoff, true) = false then
      -- Self-created task: the assignee can close it directly, from any
      -- status, no Submitted step or manager sign-off required.
      if actor_email is not null and new.assigned_to_email is not null
         and lower(actor_email) = lower(new.assigned_to_email) then
        return new;
      end if;
      if public.is_admin_tier() or actor_role = 'Executive' then
        return new;
      end if;
      raise exception 'Only the assignee (or Khuram, Kamran, or the Executive) can mark this task Completed.';
    end if;

    -- Meeting tasks: only Admin/CEO/Executive can ever mark complete —
    -- not even the manager it was routed to.
    if new.meeting_id is not null then
      if public.is_admin_tier() or actor_role = 'Executive' then
        return new;
      end if;
      raise exception 'Meeting tasks can only be marked Completed by the meeting organiser (Admin/CEO/Executive).';
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
