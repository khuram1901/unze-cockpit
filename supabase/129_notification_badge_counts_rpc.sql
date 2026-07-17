-- 129: Rule-0 cleanup (15 Jul 2026 audit, Medium) — AuthWrapper.tsx's sidebar
-- notification bell fetched the current user's own tasks plus (for
-- admin-tier users) two more tables, then did all the counting/filtering
-- in JavaScript. Small dataset today (one person's tasks + two already-
-- filtered counts), but the same pattern rule 0 flags everywhere else.
--
-- Apply manually via the Supabase SQL Editor, per project convention.

create or replace function get_notification_badge_counts(p_email text, p_today date, p_is_admin boolean default false)
returns table (
  overdue_count          bigint,
  waiting_count          bigint,
  machines_down_count    bigint,
  pending_minutes_count  bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      select count(*) from tasks
      where assigned_to_email = p_email
        and status not in ('Completed', 'Cancelled')
        and due_date is not null
        and due_date < p_today
    ) as overdue_count,
    (
      select count(*) from tasks
      where assigned_to_email = p_email
        and status = 'Waiting Reply'
    ) as waiting_count,
    case when p_is_admin then
      (select count(*) from machine_issues where issue_status = 'Down')
    else 0 end as machines_down_count,
    case when p_is_admin then
      (select count(*) from pending_minutes where status = 'pending')
    else 0 end as pending_minutes_count;
$$;

grant execute on function get_notification_badge_counts(text, date, boolean) to authenticated;
