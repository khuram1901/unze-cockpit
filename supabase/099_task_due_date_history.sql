-- Migration 099: Due-date history — automatic, tamper-proof audit trail
--
-- Khuram wants: the original due date locked forever (098), but the
-- CURRENT due date open to anyone with access to move back and forth as
-- work changes — with every move recorded, so the true history is never
-- lost even though the date itself can change.
--
-- This is done with a trigger, not application code, so it can never be
-- skipped or forgotten by whichever screen changes the due date (the
-- task detail panel today, a future bulk-edit screen, anything).
--
-- Apply via Supabase SQL Editor, after 098.

begin;

create table if not exists public.task_due_date_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  old_due_date date,
  new_due_date date,
  changed_by text,
  changed_by_email text,
  changed_at timestamptz not null default now()
);

create index if not exists idx_task_due_date_history_task_id on public.task_due_date_history(task_id);

alter table public.task_due_date_history enable row level security;

-- Same visibility rule as tasks_select: privileged, or you're the
-- assignee, or you're the one who assigned it.
drop policy if exists "task_due_date_history_select" on public.task_due_date_history;
create policy "task_due_date_history_select" on public.task_due_date_history
  for select using (
    exists (
      select 1 from public.tasks t
      where t.id = task_due_date_history.task_id
        and (
          can_access_all_tasks()
          or t.assigned_to_email = (select auth.email())
          or t.assigned_by = (select m.name from public.members m where m.email = (select auth.email()))
        )
    )
  );

-- Only the trigger function inserts rows (security definer, below) — no
-- direct-insert policy needed for normal users, keeping this table
-- append-only and tamper-resistant from the client side.

create or replace function public.log_task_due_date_change()
returns trigger as $$
declare
  actor_email text := auth.email();
  actor_name text;
begin
  if new.due_date is distinct from old.due_date then
    select name into actor_name from public.members where email = actor_email;
    insert into public.task_due_date_history (task_id, old_due_date, new_due_date, changed_by, changed_by_email)
    values (new.id, old.due_date, new.due_date, coalesce(actor_name, actor_email, 'Unknown'), actor_email);
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists tasks_log_due_date_change on public.tasks;
create trigger tasks_log_due_date_change
  after update on public.tasks
  for each row execute function public.log_task_due_date_change();

commit;
