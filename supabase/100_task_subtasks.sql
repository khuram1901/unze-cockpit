-- Migration 100: Subtasks — one flat checklist level under a task
--
-- Khuram: "a parent task cannot be marked Completed until all subtasks
-- are done." This is enforced two ways:
--   1. A trigger on tasks (below) that blocks the UPDATE outright if
--      someone tries to set status = 'Completed' while incomplete
--      subtasks exist — a real database rule, not just a disabled
--      button in the UI (matching how migration 045 upgraded the
--      protected-task rule from a UI nicety to a real one).
--   2. The UI additionally disables the "Mark complete" control so
--      people don't even see an error in the normal case.
--
-- One level only (no nested subtasks) — matches the design proposal
-- Khuram approved: a flat checklist covers the real case ("5 steps, 3
-- done") without a recursive tree to build/expand/collapse/reorder.
--
-- Apply via Supabase SQL Editor, after 098.

begin;

create table if not exists public.task_subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null,
  is_complete boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_task_subtasks_task_id on public.task_subtasks(task_id);

alter table public.task_subtasks enable row level security;

-- Anyone who can see/edit the parent task can see and manage its subtasks.
-- Mirrors tasks_select / tasks_update exactly.
drop policy if exists "task_subtasks_select" on public.task_subtasks;
create policy "task_subtasks_select" on public.task_subtasks
  for select using (
    exists (
      select 1 from public.tasks t
      where t.id = task_subtasks.task_id
        and (
          can_access_all_tasks()
          or t.assigned_to_email = (select auth.email())
          or t.assigned_by = (select m.name from public.members m where m.email = (select auth.email()))
        )
    )
  );

drop policy if exists "task_subtasks_write" on public.task_subtasks;
create policy "task_subtasks_write" on public.task_subtasks
  for all using (
    exists (
      select 1 from public.tasks t
      where t.id = task_subtasks.task_id
        and (can_access_all_tasks() or t.assigned_to_email = (select auth.email()))
    )
  )
  with check (
    exists (
      select 1 from public.tasks t
      where t.id = task_subtasks.task_id
        and (can_access_all_tasks() or t.assigned_to_email = (select auth.email()))
    )
  );

-- Stamp completed_at on each subtask automatically.
create or replace function public.stamp_subtask_completed_at()
returns trigger as $$
begin
  if new.is_complete and not old.is_complete then
    new.completed_at := now();
  elsif not new.is_complete and old.is_complete then
    new.completed_at := null;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists subtasks_stamp_completed_at on public.task_subtasks;
create trigger subtasks_stamp_completed_at
  before update on public.task_subtasks
  for each row execute function public.stamp_subtask_completed_at();

-- ── Completion gate on the parent task ──────────────────────────────────
create or replace function public.block_complete_with_open_subtasks()
returns trigger as $$
begin
  if new.status = 'Completed' and (old.status is distinct from 'Completed') then
    if exists (select 1 from public.task_subtasks where task_id = new.id and not is_complete) then
      raise exception 'Cannot mark this task Completed — it still has unfinished subtasks.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists tasks_block_complete_with_open_subtasks on public.tasks;
create trigger tasks_block_complete_with_open_subtasks
  before update on public.tasks
  for each row execute function public.block_complete_with_open_subtasks();

commit;
