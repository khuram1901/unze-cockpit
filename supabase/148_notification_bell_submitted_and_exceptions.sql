-- Khuram: "build the trigger for bell notification, so all pending tasks,
-- alerts, red alerts go on the bell icon for everyone. so if they have a
-- task outstanding, submitted, an alert, or a notification it shows up
-- for them."
--
-- The bell (get_notification_badge_counts, called from every logged-in
-- session in AuthWrapper.tsx) previously only counted: overdue tasks,
-- waiting-reply tasks, and (admin-only) machines down / pending minutes.
-- It never counted "Submitted" tasks at all — the exact gap behind the
-- earlier "Nadeem's manager never saw his submitted task" bug — and never
-- surfaced the schema's existing exception/explanation-required flag,
-- which is this app's actual "red alert on a task" mechanism.
--
-- Also fixes the same dual-identity gap fixed on the Executive Dashboard:
-- Khuram has two login accounts (Admin + CEO) that are the same person for
-- "is this mine" purposes. The old signature took a single p_email; a task
-- routed to whichever of his accounts he wasn't logged in as would never
-- count. Now takes p_emails text[] — the client passes myIdentityEmails()
-- (just [email] for everyone except Khuram, both of his for him).
--
-- Signature is changing (text -> text[]), so the old function must be
-- dropped first — Postgres won't let CREATE OR REPLACE change parameter
-- types.
drop function if exists public.get_notification_badge_counts(text, date, boolean);

create or replace function public.get_notification_badge_counts(
  p_emails text[],
  p_today date,
  p_is_admin boolean default false
)
returns table(
  overdue_count bigint,
  waiting_count bigint,
  submitted_count bigint,
  exception_count bigint,
  machines_down_count bigint,
  pending_minutes_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      select count(*) from tasks
      where assigned_to_email = any(p_emails)
        and status not in ('Completed', 'Cancelled')
        and due_date is not null
        and due_date < p_today
    ) as overdue_count,
    (
      select count(*) from tasks
      where assigned_to_email = any(p_emails)
        and status = 'Waiting Reply'
    ) as waiting_count,
    (
      -- Tasks routed back to this person (or their identity group) on
      -- Submit — see migration 143 (route_submitted_task) and the
      -- manager-hierarchy visibility work. This is the category that was
      -- completely missing from the bell.
      select count(*) from tasks
      where assigned_to_email = any(p_emails)
        and status = 'Submitted'
    ) as submitted_count,
    (
      -- explanation_required is this schema's existing "this needs a red
      -- alert / exception" flag (set on exception-type tasks — KPI
      -- misses, stuck receivables, etc.) — never surfaced on the bell
      -- before despite already being the system's built-in mechanism for
      -- exactly what Khuram is asking for.
      select count(*) from tasks
      where assigned_to_email = any(p_emails)
        and status not in ('Completed', 'Cancelled')
        and explanation_required = true
    ) as exception_count,
    case when p_is_admin then
      (select count(*) from machine_issues where issue_status = 'Down')
    else 0 end as machines_down_count,
    case when p_is_admin then
      (select count(*) from pending_minutes where status = 'pending')
    else 0 end as pending_minutes_count;
$$;
