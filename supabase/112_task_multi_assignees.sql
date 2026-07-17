-- Migration 112: Multi-assignee support for tasks
--
-- Khuram: "there has to be an option to assign more than one owner —
-- the same task assigned to multiple members." Chose real shared
-- ownership over a lighter "notify others" version: every person added
-- gets the task in their own My Tasks list, not just a heads-up.
--
-- tasks.assigned_to / assigned_to_email / assigned_to_department /
-- assigned_to_business_unit are UNCHANGED and remain the "primary" owner —
-- every existing report, filter, notification, WhatsApp reminder, and RPC
-- that reads those columns keeps working exactly as before. This
-- migration is purely additive: a new join table holds the full owner
-- list (primary owner included), so anything that needs "who owns this
-- task" can query task_assignees alone going forward.
--
-- Critical detail: task visibility is enforced by RLS on tasks itself
-- (tasks_select/tasks_update), not just the app's own query filters. A
-- co-assignee who isn't the primary owner would otherwise be silently
-- blocked from ever seeing a task they were added to — so this migration
-- also extends those two policies, via a SECURITY DEFINER helper function
-- (avoids the RLS-policies-checking-each-other recursion you'd get from
-- referencing the tables directly both ways).
--
-- Apply via Supabase SQL Editor, after 111.

begin;

create table if not exists public.task_assignees (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  member_id uuid references public.members(id) on delete set null,
  member_name text not null,
  member_email text,
  created_at timestamptz not null default now(),
  unique (task_id, member_email)
);

create index if not exists task_assignees_task_id_idx on public.task_assignees (task_id);
create index if not exists task_assignees_member_email_idx on public.task_assignees (member_email);

alter table public.task_assignees enable row level security;

-- Bypasses RLS deliberately (security definer) so tasks_select/tasks_update
-- can check "am I a co-assignee" without re-triggering task_assignees'
-- own policies, and so task_assignees' own policies can check "do I own
-- or did I create this task" without re-triggering tasks_select.
create or replace function public.is_task_assignee(p_task_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.task_assignees
    where task_id = p_task_id and member_email = (select auth.email())
  );
$$;

create or replace function public.owns_or_created_task(p_task_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.tasks
    where id = p_task_id
      and (assigned_to_email = (select auth.email()) or assigned_by_email = (select auth.email()))
  );
$$;

create or replace function public.is_task_creator(p_task_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.tasks
    where id = p_task_id and assigned_by_email = (select auth.email())
  );
$$;

drop policy if exists "task_assignees_select" on public.task_assignees;
create policy "task_assignees_select" on public.task_assignees
  for select using (
    can_access_all_tasks()
    or member_email = (select auth.email())
    or owns_or_created_task(task_assignees.task_id)
  );

-- Only Admin/Exec or whoever created the task manages the owner list —
-- matches canEditTask() in the app, which already restricts core-field
-- edits (description/priority/company/etc.) to the creator or a
-- privileged role, not just any current assignee.
drop policy if exists "task_assignees_write" on public.task_assignees;
create policy "task_assignees_write" on public.task_assignees
  for all using (
    can_access_all_tasks() or is_task_creator(task_assignees.task_id)
  )
  with check (
    can_access_all_tasks() or is_task_creator(task_assignees.task_id)
  );

alter policy tasks_select on public.tasks
  using (
    can_access_all_tasks()
    or (assigned_to_email = (select auth.email()))
    or (assigned_by = (select members.name from members where members.email = (select auth.email())))
    or is_task_assignee(tasks.id)
  );

alter policy tasks_update on public.tasks
  using (
    can_access_all_tasks()
    or (assigned_to_email = (select auth.email()))
    or is_task_assignee(tasks.id)
  );

-- Backfill: every existing task's current owner becomes its first (and,
-- until edited, only) assignee row, so nothing "loses" its owner when
-- this rolls out.
insert into public.task_assignees (task_id, member_id, member_name, member_email)
select t.id, m.id, t.assigned_to, t.assigned_to_email
from public.tasks t
left join public.members m on m.email = t.assigned_to_email
where t.assigned_to is not null
on conflict (task_id, member_email) do nothing;

commit;
