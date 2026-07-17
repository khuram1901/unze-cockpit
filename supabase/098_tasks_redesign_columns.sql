-- Migration 098: Tasks redesign — company tag, stage, locked dates, completion timestamp
--
-- Adds the columns needed for the Tasks page redesign Khuram approved
-- (design mockup: Tasks_Page_Mockup.html). Nothing here changes what's
-- currently on screen — every new column is nullable and every existing
-- row keeps working exactly as before until the app starts using them.
--
-- What this adds, in plain terms:
--   company_id         — which company (UTPL/IFPL/Baranh/Haute Dolci) the
--                        task belongs to. Null = "Group / needs review",
--                        exactly the fallback bucket agreed in the mockup.
--   stage              — optional free-text pipeline label, separate from
--                        status (e.g. "Submitted to Civil Dept"). Most
--                        tasks won't use this.
--   original_due_date  — captured once and then locked forever, even if
--                        due_date is legitimately moved later. Backfilled
--                        from the current due_date for existing tasks —
--                        for tasks whose due date was already moved before
--                        this migration ran, this backfill is the closest
--                        available proxy, not the true original.
--   completed_at       — stamped automatically the moment status becomes
--                        'Completed'; cleared automatically if reopened.
--                        This is what finally makes an on-time-completion
--                        rate computable on the Team view.
--
-- Two triggers do the enforcement so the rule holds no matter which code
-- path touches the row (the app, a CSV import, a future script) — not
-- just a UI-level nicety:
--   1. lock_task_dates()   — reverts any attempt to change assigned_date
--                            or original_due_date after the row is created.
--   2. stamp_task_completed_at() — sets/clears completed_at based on
--                            status transitions.
--
-- Apply via Supabase SQL Editor. Additive only — no existing behaviour
-- changes until the app code (next migrations + this feature's UI) uses
-- these columns.

begin;

alter table public.tasks
  add column if not exists company_id uuid references public.companies(id),
  add column if not exists stage text,
  add column if not exists original_due_date date,
  add column if not exists completed_at timestamptz;

-- Backfill: best available proxy for tasks created before this feature.
update public.tasks
set original_due_date = due_date
where original_due_date is null and due_date is not null;

update public.tasks
set completed_at = updated_at
where status = 'Completed' and completed_at is null and updated_at is not null;

-- ── Trigger 1: lock assigned_date and original_due_date forever ────────
create or replace function public.lock_task_dates()
returns trigger as $$
begin
  new.assigned_date := old.assigned_date;
  new.original_due_date := old.original_due_date;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists tasks_lock_dates on public.tasks;
create trigger tasks_lock_dates
  before update on public.tasks
  for each row execute function public.lock_task_dates();

-- On INSERT, if original_due_date wasn't explicitly supplied, capture it
-- once from due_date — this is the one and only time it's ever set.
create or replace function public.set_original_due_date()
returns trigger as $$
begin
  if new.original_due_date is null then
    new.original_due_date := new.due_date;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists tasks_set_original_due_date on public.tasks;
create trigger tasks_set_original_due_date
  before insert on public.tasks
  for each row execute function public.set_original_due_date();

-- ── Trigger 2: stamp / clear completed_at automatically ─────────────────
create or replace function public.stamp_task_completed_at()
returns trigger as $$
begin
  if new.status = 'Completed' and (old.status is distinct from 'Completed') then
    new.completed_at := now();
  elsif new.status <> 'Completed' and old.status = 'Completed' then
    new.completed_at := null;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists tasks_stamp_completed_at on public.tasks;
create trigger tasks_stamp_completed_at
  before update on public.tasks
  for each row execute function public.stamp_task_completed_at();

commit;
