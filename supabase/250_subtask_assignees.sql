-- Migration 250: Subtask assignees
--
-- Adds:
--   · assigned_via column on task_assignees ('main_task' | 'subtask')
--   · is_main_task_assignee() helper — stricter than is_task_assignee(),
--     only matches rows where assigned_via = 'main_task'
--   · task_subtask_assignees table — join table for per-subtask assignees
--   · Referential integrity trigger — ensures subtask_id.task_id = task_id
--   · Completed-task lock trigger — mirrors migration 120 for this table;
--     uses OLD for DELETE, NEW for INSERT/UPDATE
--   · RLS on task_subtask_assignees
--
-- Corrections applied per review (2026-09-25):
--   B1: write gates use is_main_task_assignee(), not is_task_assignee()
--   B2: upgrade path: main-task owner syncs must upsert to promote 'subtask'→'main_task'
--       (handled in app code; schema supports it via no unique constraint on assigned_via)
--   B3: multiple assignees per subtask via UNIQUE(subtask_id, member_email) not UNIQUE(subtask_id)
--   B4: Completed-task trigger handles DELETE using OLD, INSERT/UPDATE using NEW
--   B5: task_subtask_assignees SELECT uses EXISTS against tasks table
--
-- DO NOT apply without explicit approval.
-- Apply via Supabase SQL Editor, after 249.

begin;

-- ─── 1. assigned_via on task_assignees ────────────────────────────────────
alter table public.task_assignees
  add column if not exists assigned_via text not null default 'main_task'
  check (assigned_via in ('main_task', 'subtask'));

comment on column public.task_assignees.assigned_via is
  'main_task = primary/co-owner; subtask = added only for visibility via a subtask assignment';

-- ─── 2. is_main_task_assignee() ──────────────────────────────────────────
-- Stricter than is_task_assignee(): only matches rows with assigned_via = 'main_task'.
-- Used to gate writes on task_subtask_assignees so subtask-only members
-- cannot manage other subtask assignees.
create or replace function public.is_main_task_assignee(p_task_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.task_assignees
    where task_id = p_task_id
      and member_email = (select auth.email())
      and assigned_via = 'main_task'
  );
$$;

-- ─── 3. task_subtask_assignees ────────────────────────────────────────────
create table if not exists public.task_subtask_assignees (
  id                uuid        primary key default gen_random_uuid(),
  subtask_id        uuid        not null references public.task_subtasks(id) on delete cascade,
  task_id           uuid        not null references public.tasks(id) on delete cascade,
  member_id         uuid        references public.members(id) on delete set null,
  member_name       text        not null,
  member_email      text        not null,
  assigned_by_email text        not null,
  created_at        timestamptz not null default now(),
  unique (subtask_id, member_email)   -- multiple assignees per subtask; one row per (subtask, member)
);

create index if not exists tsa_task_id_idx      on public.task_subtask_assignees (task_id);
create index if not exists tsa_subtask_id_idx   on public.task_subtask_assignees (subtask_id);
create index if not exists tsa_member_email_idx on public.task_subtask_assignees (member_email);

alter table public.task_subtask_assignees enable row level security;

-- ─── 4. Referential integrity trigger ────────────────────────────────────
-- Ensures subtask_id actually belongs to task_id at the DB level.
-- API route also validates this (defence in depth).
create or replace function public.tsa_check_subtask_belongs_to_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.task_subtasks s
    where s.id = NEW.subtask_id
      and s.task_id = NEW.task_id
  ) then
    raise exception 'subtask % does not belong to task %', NEW.subtask_id, NEW.task_id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists tsa_check_subtask_task on public.task_subtask_assignees;
create trigger tsa_check_subtask_task
  before insert or update on public.task_subtask_assignees
  for each row execute function public.tsa_check_subtask_belongs_to_task();

-- ─── 5. Completed-task lock trigger ──────────────────────────────────────
-- Blocks add/remove of subtask assignees when the parent task is Completed,
-- unless the caller is admin-tier. Uses OLD for DELETE, NEW for INSERT/UPDATE.
create or replace function public.tsa_enforce_completed_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task_id uuid;
  v_status  text;
begin
  if TG_OP = 'DELETE' then
    v_task_id := OLD.task_id;
  else
    v_task_id := NEW.task_id;
  end if;

  select status into v_status from public.tasks where id = v_task_id;

  if v_status = 'Completed' and not public.is_admin_tier() then
    raise exception 'Cannot change subtask assignees on a Completed task.';
  end if;

  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

drop trigger if exists tsa_enforce_completed_lock on public.task_subtask_assignees;
create trigger tsa_enforce_completed_lock
  before insert or update or delete on public.task_subtask_assignees
  for each row execute function public.tsa_enforce_completed_lock();

-- ─── 6. RLS policies on task_subtask_assignees ───────────────────────────

-- SELECT: visible if you can see the parent task (uses EXISTS, not assigned_to_email directly)
drop policy if exists "tsa_select" on public.task_subtask_assignees;
create policy "tsa_select" on public.task_subtask_assignees
  for select using (
    can_access_all_tasks()
    or is_task_assignee(task_id)
    or exists (
      select 1 from public.tasks t
      where t.id = task_subtask_assignees.task_id
        and t.assigned_to_email = (select auth.email())
    )
  );

-- INSERT: only main-task owners, creators, or admin — NOT subtask-only assignees
drop policy if exists "tsa_insert" on public.task_subtask_assignees;
create policy "tsa_insert" on public.task_subtask_assignees
  for insert with check (
    can_access_all_tasks()
    or is_task_creator(task_id)
    or is_main_task_assignee(task_id)
  );

-- DELETE: same gate
drop policy if exists "tsa_delete" on public.task_subtask_assignees;
create policy "tsa_delete" on public.task_subtask_assignees
  for delete using (
    can_access_all_tasks()
    or is_task_creator(task_id)
    or is_main_task_assignee(task_id)
  );

commit;
