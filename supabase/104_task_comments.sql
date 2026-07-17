-- Migration 104: task_comments — the Comments section from the finalised
-- Tasks mockup, never actually built until now.
--
-- One flat comment list per task, oldest first. RLS mirrors tasks_select
-- (same "privileged, or assigned-to-me, or assigned-by-me" rule as every
-- other task-linked table in this rebuild) for SELECT, and the same rule
-- for INSERT so only someone who can already see the task can comment on
-- it. No UPDATE/DELETE policy — comments are an append-only log, same
-- spirit as task_due_date_history.
--
-- Apply via Supabase SQL Editor, after 098-103.

begin;

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  comment_text text not null,
  commented_by text,
  commented_by_email text,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_comments_task_id on public.task_comments(task_id);

alter table public.task_comments enable row level security;

create policy task_comments_select on public.task_comments
  for select
  using (
    exists (
      select 1 from public.tasks t
      where t.id = task_comments.task_id
        and (
          can_access_all_tasks()
          or t.assigned_to_email = (select auth.email())
          or t.assigned_by = (select m.name from public.members m where m.email = (select auth.email()))
        )
    )
  );

create policy task_comments_insert on public.task_comments
  for insert
  with check (
    exists (
      select 1 from public.tasks t
      where t.id = task_comments.task_id
        and (
          can_access_all_tasks()
          or t.assigned_to_email = (select auth.email())
          or t.assigned_by = (select m.name from public.members m where m.email = (select auth.email()))
        )
    )
  );

commit;
