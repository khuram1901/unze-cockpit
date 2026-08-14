-- Migration 208: prior-year net sales total for upload consistency check
-- The Imperial upload route compares the workbook's own year-summary claims
-- (e.g. "FY 2025-26 net sales") against what the app has stored and
-- confirmed. Aggregation in the database per house rule 0.

create or replace function ifpl_net_sales_total(p_from date, p_to date)
returns numeric
language sql
security definer
set search_path = public
as $$
  select coalesce(sum(actual), 0)
  from ifpl_pnl_lines
  where line = 'Net Sales'
    and month >= p_from
    and month <= p_to;
$$;

revoke execute on function ifpl_net_sales_total(date, date) from public, anon;
grant execute on function ifpl_net_sales_total(date, date) to authenticated, service_role;
