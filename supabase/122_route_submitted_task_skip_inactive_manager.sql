-- Migration 122: Submitted-task routing skips offboarded managers
--
-- Found during the 15 Jul 2026 full-app audit: both routeSubmittedTask()
-- (app/lib/taskRouting.ts) and this trigger's forward-routing branch
-- (migration 116) reassigned a Submitted task to manager_id without
-- checking members.is_active. Since inactive members are filtered out
-- of every picker in the app (task #166), a task routed to an offboarded
-- manager became invisible and effectively stuck forever, with no
-- fallback layer catching it.
--
-- Khuram's decision: skip up the chain to that manager's own manager,
-- repeating until an active one is found. Capped at 10 hops as a guard
-- against a bad/circular manager_id chain; falls back to no
-- reassignment if the chain runs out or loops, rather than guessing.
-- Mirrors the walk-up-chain logic now in app/lib/taskRouting.ts exactly,
-- same as every other rule this trigger backstops at the database level.
--
-- Only the forward-routing branch changes here — the hand-back branch
-- (Submitted -> anything else) already goes to a specific named person
-- (submitted_by_email, the original task owner), not up a management
-- chain, so there's nothing to walk for that direction.
--
-- Apply via Supabase SQL Editor, after 121.

begin;

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
  if new.status = 'Submitted' and (old.status is distinct from 'Submitted') then
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

-- Trigger itself is unchanged (function replaced in place), but re-stated
-- here for clarity/consistency with every other migration in this series.
drop trigger if exists tasks_route_submitted on public.tasks;
create trigger tasks_route_submitted
  before update on public.tasks
  for each row execute function public.route_submitted_task();

commit;
