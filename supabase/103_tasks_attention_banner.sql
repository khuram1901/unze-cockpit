-- Migration 103: add urgent_count to get_tasks_kpi_summary, for the
-- "Needs Your Attention" banner (Critical / Overdue / Due Today / Stuck).
--
-- This is a genuine gap-closing fix: the finalised Tasks mockup designed a
-- red attention banner with a "Critical (Urgent, open)" count as its first
-- stat, and that never made it into the real build. The KPI RPC from
-- migration 101 didn't return this count, so it has to be added here.
-- Return type changes require dropping the function first (Postgres won't
-- let you CREATE OR REPLACE with a different column list).
--
-- Apply via Supabase SQL Editor, after 098-102.

begin;

drop function if exists public.get_tasks_kpi_summary(uuid, boolean);

create or replace function public.get_tasks_kpi_summary(
  p_company_id uuid default null,
  p_group_only boolean default false
)
returns table (
  open_count bigint,
  overdue_count bigint,
  due_today_count bigint,
  waiting_reply_count bigint,
  stuck_count bigint,
  completed_count bigint,
  urgent_open_count bigint
) as $$
  select
    count(*) filter (where status not in ('Completed', 'Cancelled')) as open_count,
    count(*) filter (where status not in ('Completed', 'Cancelled') and due_date < current_date) as overdue_count,
    count(*) filter (where status not in ('Completed', 'Cancelled') and due_date = current_date) as due_today_count,
    count(*) filter (where status = 'Waiting Reply') as waiting_reply_count,
    count(*) filter (where status = 'Stuck') as stuck_count,
    count(*) filter (where status = 'Completed') as completed_count,
    count(*) filter (where status not in ('Completed', 'Cancelled') and priority = 'Urgent') as urgent_open_count
  from public.tasks
  where
    (
      can_access_all_tasks()
      or assigned_to_email = (select auth.email())
      or assigned_by = (select m.name from public.members m where m.email = (select auth.email()))
    )
    and (
      (p_group_only and company_id is null)
      or (not p_group_only and p_company_id is not null and company_id = p_company_id)
      or (not p_group_only and p_company_id is null)
    );
$$ language sql stable security definer set search_path = public;

commit;
