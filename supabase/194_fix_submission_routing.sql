-- Migration 194: Fix submission routing race condition
--
-- PROBLEM: Two bugs interacting:
--
-- 1. Split-brain data on the Civil Defense Certificate task: tasks.assigned_to
--    says "Muhammad Akhlaq" but task_assignees still has "Hafiz Adnan"
--    (inserted today at 10:18 UTC when the HOD return-routing fired).
--    This caused the task to not appear in Akhlaq's view correctly.
--
-- 2. DB trigger route_submitted_task() has TWO parts:
--    Part 1: status → Submitted  → route to manager  (correct, keep)
--    Part 2: status FROM Submitted → anything → return to submitter (PROBLEM)
--
--    Part 2 means if the HOD (Akhlaq) changes a Submitted task to "In Progress"
--    (intending "I'm working on this review"), the trigger automatically returns
--    the task to Adnan. Adnan, confused, re-submits. Back to Akhlaq as Submitted.
--    The cycle repeats endlessly.
--
--    The return-to-submitter is now handled EXPLICITLY via a "Return to [name]"
--    button in TaskStatus.tsx, so the trigger's automatic return is removed.
--
--    App-level routeSubmittedTask() and handBackIfLeaving() in the frontend
--    are also removed — the trigger handles submission routing atomically,
--    preventing the race condition on task_assignees.
--
-- Apply manually via Supabase SQL Editor.

-- ── 1. Fix the Civil Defense task's split-brain state ──────────────────────
-- task_assignees wrongly has Adnan; task is properly at Akhlaq for review.

DELETE FROM public.task_assignees
WHERE task_id = '696a738d-9c2c-4f51-b1b0-b96af68afcca';

INSERT INTO public.task_assignees (task_id, member_id, member_name, member_email)
SELECT
  '696a738d-9c2c-4f51-b1b0-b96af68afcca',
  id,
  name,
  email
FROM public.members
WHERE email = 'akhlaq@unze.co.uk';

-- ── 2. Update the DB trigger — remove the automatic return-to-submitter ─────
-- Keep Part 1 (submission routing to manager) which is fast and atomic.
-- Remove Part 2 (return routing) since the app now handles this explicitly
-- via a dedicated "Return to [name]" button, preventing the return-cycle bug.

CREATE OR REPLACE FUNCTION public.route_submitted_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  next_id uuid;
  owner_role text;
  candidate record;
  mgr record;
  hop int;
begin
  -- Part 1: route to manager when status flips TO Submitted
  if new.status = 'Submitted'
    and (old.status is distinct from 'Submitted')
    and coalesce(new.requires_manager_signoff, true)
  then
    if old.assigned_to_email is not null then
      select manager_id, role into next_id, owner_role
      from public.members
      where lower(email) = lower(old.assigned_to_email);

      if next_id is not null and owner_role is distinct from 'Executive' then
        mgr := null;
        hop := 0;
        while next_id is not null and hop < 10 loop
          hop := hop + 1;
          select id, name, email, department, business_unit, is_active, manager_id
          into candidate
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

          new.assigned_to          := mgr.name;
          new.assigned_to_email    := mgr.email;
          new.assigned_to_department := mgr.department;
          new.assigned_to_business_unit := mgr.business_unit;
          new.assigned_by          := old.assigned_to;
          new.assigned_by_email    := old.assigned_to_email;
          new.submitted_by_name    := old.assigned_to;
          new.submitted_by_email   := old.assigned_to_email;
        end if;
      end if;
    end if;
  end if;

  -- Part 2 (return-to-submitter on status change FROM Submitted) has been
  -- REMOVED. It caused a re-submission cycle: HOD sets In Progress →
  -- trigger returns to Adnan → Adnan re-submits → back to HOD as Submitted.
  -- The app now shows an explicit "Return to [name]" button instead.

  return new;
end;
$$;

-- Verify fix:
-- SELECT t.assigned_to, t.assigned_to_email, t.status, t.submitted_by_name, ta.member_name as ta_member
-- FROM tasks t
-- LEFT JOIN task_assignees ta ON ta.task_id = t.id
-- WHERE t.id = '696a738d-9c2c-4f51-b1b0-b96af68afcca';
