-- 128: Rule-0 cleanup (15 Jul 2026 audit) — app/audit-log/page.tsx fetched up to
-- 500 raw rows via .limit(500) and computed the KPI counts (Today/Created/
-- Updated/Deleted/Total) and the "By Department" donut in JavaScript from
-- that capped fetch. Live table has 1,011 rows today, so every one of those
-- numbers was already silently wrong (e.g. "Total" showed 500, not 1,011).
--
-- These two RPCs compute the same numbers over the FULL table instead.
-- The row-level list (the actual log entries shown to the user, grouped by
-- time/department/person) still fetches a capped, ordered set for display —
-- that's pagination, not aggregation, and is out of scope for this fix.
--
-- Apply manually via the Supabase SQL Editor, per project convention.

create or replace function get_audit_log_stats(p_search text default null)
returns table (
  total_count   bigint,
  today_count   bigint,
  created_count bigint,
  updated_count bigint,
  deleted_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with tagged as (
    select
      a.*,
      case a.table_name
        when 'tasks' then 'Tasks'
        when 'members' then 'Members'
        when 'audit_plan_items' then 'Audit'
        when 'legal_notices' then 'Taxation'
        when 'recruitment_positions' then 'HR'
        when 'meeting_requests' then 'Meetings'
        when 'meetings' then 'Meetings'
        when 'meeting_tasks' then 'Meetings'
        when 'cash_opening_balance' then 'Finance'
        when 'monthly_cash_plan' then 'Finance'
        when 'daily_cash_position' then 'Finance'
        when 'monthly_budgets' then 'Finance'
        when 'production_entries' then 'Production'
        when 'dispatch_entries' then 'Dispatch'
        when 'breakage_entries' then 'Breakage'
        when 'machine_issues' then 'Machines'
        when 'department_owners' then 'Dept Owners'
        when 'opening_balances' then 'Opening Bal.'
        when 'receivables' then 'Receivables'
        else a.table_name
      end as department
    from audit_log a
  ),
  filtered as (
    select *
    from tagged
    where p_search is null or p_search = '' or (
      user_name ilike '%' || p_search || '%' or
      user_email ilike '%' || p_search || '%' or
      table_name ilike '%' || p_search || '%' or
      action ilike '%' || p_search || '%' or
      details ilike '%' || p_search || '%' or
      department ilike '%' || p_search || '%'
    )
  )
  select
    count(*) as total_count,
    count(*) filter (
      where (created_at at time zone 'Asia/Karachi')::date = (now() at time zone 'Asia/Karachi')::date
    ) as today_count,
    count(*) filter (where action = 'Created') as created_count,
    count(*) filter (where action ilike 'Updated%') as updated_count,
    count(*) filter (where action = 'Deleted') as deleted_count
  from filtered;
$$;

grant execute on function get_audit_log_stats(text) to authenticated;

create or replace function get_audit_log_department_breakdown(p_search text default null)
returns table (
  department  text,
  entry_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with tagged as (
    select
      a.*,
      case a.table_name
        when 'tasks' then 'Tasks'
        when 'members' then 'Members'
        when 'audit_plan_items' then 'Audit'
        when 'legal_notices' then 'Taxation'
        when 'recruitment_positions' then 'HR'
        when 'meeting_requests' then 'Meetings'
        when 'meetings' then 'Meetings'
        when 'meeting_tasks' then 'Meetings'
        when 'cash_opening_balance' then 'Finance'
        when 'monthly_cash_plan' then 'Finance'
        when 'daily_cash_position' then 'Finance'
        when 'monthly_budgets' then 'Finance'
        when 'production_entries' then 'Production'
        when 'dispatch_entries' then 'Dispatch'
        when 'breakage_entries' then 'Breakage'
        when 'machine_issues' then 'Machines'
        when 'department_owners' then 'Dept Owners'
        when 'opening_balances' then 'Opening Bal.'
        when 'receivables' then 'Receivables'
        else a.table_name
      end as department
    from audit_log a
  ),
  filtered as (
    select *
    from tagged
    where p_search is null or p_search = '' or (
      user_name ilike '%' || p_search || '%' or
      user_email ilike '%' || p_search || '%' or
      table_name ilike '%' || p_search || '%' or
      action ilike '%' || p_search || '%' or
      details ilike '%' || p_search || '%' or
      department ilike '%' || p_search || '%'
    )
  )
  select department, count(*) as entry_count
  from filtered
  group by department
  order by entry_count desc;
$$;

grant execute on function get_audit_log_department_breakdown(text) to authenticated;
