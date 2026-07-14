-- Migration 107: Tighten tasks_insert RLS to match canCreateAssignments()
--
-- Part of the access-matrix review Khuram asked for alongside the
-- task-creation consolidation (see TASK_NOTIFICATION_AUDIT.md).
--
-- Finding: the tasks_insert RLS policy currently reads
--   with_check: true
-- i.e. ANY authenticated user can insert a row into `tasks` directly via
-- the Supabase client/REST API, regardless of role. This predates this
-- session's work — it was already this permissive. The only thing that
-- ever stopped a regular Member from assigning themselves or someone else
-- a task was the UI hiding the "+ New Task" / "+ Assign Task" buttons
-- behind canCreateAssignments() (app/lib/permissions.ts) — a client-side
-- gate only, easily bypassed by anyone calling the API directly.
--
-- Now that every task-creation path in the app goes through
-- /api/tasks/create (which uses the service-role client and already
-- re-checks canCreateAssignments() server-side as of this same change),
-- nothing in the app itself still relies on a permissive tasks_insert
-- policy — confirmed by grepping the whole codebase: the only two
-- remaining `.from("tasks").insert(...)` call sites are both server-side
-- with the service-role client (which bypasses RLS entirely regardless
-- of this policy). This migration closes the matching gap at the
-- database layer, so a direct REST/PostgREST call with a valid user
-- token can no longer do what the UI never allowed.
--
-- can_create_tasks() mirrors canCreateAssignments() exactly: privileged
-- (Admin/CEO/Executive) OR a Manager in Unze Trading Ops, with the same
-- per-member override support via member_permissions.can_create_tasks.
--
-- Apply via Supabase SQL Editor, after 106.

begin;

create or replace function public.can_create_tasks()
returns boolean as $$
declare ov boolean;
begin
  ov := perm_override('can_create_tasks');
  if ov is not null then return ov; end if;
  return is_privileged() or (get_user_role() = 'Manager' and get_user_department() = 'Unze Trading Ops');
end;
$$ language plpgsql stable security definer set search_path = public;

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert
  with check (can_create_tasks());

commit;
