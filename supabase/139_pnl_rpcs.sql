-- P&L read RPCs (Phase 1: Unze Trading). All aggregation happens here in
-- Postgres, never in the API route or the page — per the house rule in
-- CLAUDE.md. Every function is security definer + fixed search_path.
-- Apply manually via the Supabase SQL Editor — do not auto-run.

-- One row per month, the 8 SData-style lines pulled straight off the
-- plant='Total' rows already stored at upload time (no re-summing plants
-- here — pnl_line_items.plant = 'Total' IS the file's own reported total,
-- which is exactly what the validation checks confirmed reconciles).
create or replace function pnl_kpi_summary(p_company_id uuid, p_from date, p_to date)
returns table (
  month date,
  gross_sale numeric,
  cost_of_sale numeric,
  gross_profit numeric,
  operating_expenses numeric,
  taxation numeric,
  net_profit_after_tax numeric,
  non_operating numeric,
  net_profit_final numeric
)
security definer
set search_path = public
language sql
as $$
  select
    month,
    max(amount) filter (where line = 'Gross Sale')                              as gross_sale,
    max(amount) filter (where line = 'Total Cost of Sale')                      as cost_of_sale,
    max(amount) filter (where line = 'GP')                                      as gross_profit,
    max(amount) filter (where line = 'Operating Expenses-Admin&Selling')        as operating_expenses,
    max(amount) filter (where line = 'Taxation')                                as taxation,
    max(amount) filter (where line = 'Net Profit After Tax')                    as net_profit_after_tax,
    max(amount) filter (where line = 'Non Operating Income and exp.')           as non_operating,
    max(amount) filter (where line = 'Net Profit After Non Opr.Income&Exp')     as net_profit_final
  from pnl_line_items
  where company_id = p_company_id
    and plant = 'Total'
    and month between p_from and p_to
  group by month
  order by month;
$$;

-- Per-plant profit for the segment bar (excludes the Total row).
create or replace function pnl_segment_breakdown(p_company_id uuid, p_month date)
returns table (plant text, gross_profit numeric)
security definer
set search_path = public
language sql
as $$
  select plant, max(amount) filter (where line = 'GP') as gross_profit
  from pnl_line_items
  where company_id = p_company_id
    and month = p_month
    and plant <> 'Total'
  group by plant
  order by plant;
$$;

-- Account-group ledger detail, one row per (plant, group, month) — the
-- frontend arranges these rows into the overheads drill-down grid; no sums
-- happen client-side, the sum is the group-by below.
create or replace function pnl_overheads_breakdown(p_company_id uuid, p_plant text, p_from date, p_to date)
returns table (month date, plant text, account_group text, amount numeric)
security definer
set search_path = public
language sql
as $$
  select month, plant, account_group, sum(amount) as amount
  from pnl_ledger_lines
  where company_id = p_company_id
    and month between p_from and p_to
    and (p_plant = 'All plants' or plant = p_plant)
  group by month, plant, account_group
  order by month, account_group;
$$;

-- Year-to-date totals for the fiscal year containing p_month, vs the same
-- YTD window one year earlier.
create or replace function pnl_ytd_summary(p_company_id uuid, p_month date)
returns table (
  ytd_sales numeric, ytd_sales_last_year numeric,
  ytd_profit numeric, ytd_profit_last_year numeric
)
security definer
set search_path = public
language sql
as $$
  with bounds as (
    select date_trunc('year', p_month)::date as year_start
  )
  select
    (select sum(amount) from pnl_line_items, bounds
       where company_id = p_company_id and plant = 'Total' and line = 'Gross Sale'
         and month between bounds.year_start and p_month),
    (select sum(amount) from pnl_line_items, bounds
       where company_id = p_company_id and plant = 'Total' and line = 'Gross Sale'
         and month between bounds.year_start - interval '1 year' and p_month - interval '1 year'),
    (select sum(amount) from pnl_line_items, bounds
       where company_id = p_company_id and plant = 'Total' and line = 'GP'
         and month between bounds.year_start and p_month),
    (select sum(amount) from pnl_line_items, bounds
       where company_id = p_company_id and plant = 'Total' and line = 'GP'
         and month between bounds.year_start - interval '1 year' and p_month - interval '1 year');
$$;

-- Month-to-month profit bridge inputs: this month and prior month's
-- Sales/COGS/OpEx/Tax off the Total row. The waterfall arithmetic itself
-- (the four deltas) is trivial subtraction done in the component from these
-- four numbers — not a sum/reduce over rows, so it stays out of the RPC.
create or replace function pnl_profit_bridge(p_company_id uuid, p_month date)
returns table (
  month date, gross_sale numeric, cost_of_sale numeric,
  operating_expenses numeric, taxation numeric, net_profit_after_tax numeric
)
security definer
set search_path = public
language sql
as $$
  select month,
    max(amount) filter (where line = 'Gross Sale'),
    max(amount) filter (where line = 'Total Cost of Sale'),
    max(amount) filter (where line = 'Operating Expenses-Admin&Selling'),
    max(amount) filter (where line = 'Taxation'),
    max(amount) filter (where line = 'Net Profit After Tax')
  from pnl_line_items
  where company_id = p_company_id
    and plant = 'Total'
    and month in (p_month, (p_month - interval '1 month')::date)
  group by month
  order by month;
$$;

-- Account groups that had zero recorded spend in every prior month on file
-- but a nonzero amount this month — flags a cost line appearing for the
-- first time so it doesn't slip past unnoticed.
create or replace function pnl_new_account_flags(p_company_id uuid, p_month date)
returns table (plant text, account_group text, amount numeric)
security definer
set search_path = public
language sql
as $$
  select cur.plant, cur.account_group, sum(cur.amount) as amount
  from pnl_ledger_lines cur
  where cur.company_id = p_company_id
    and cur.month = p_month
    and not exists (
      select 1 from pnl_ledger_lines prior
      where prior.company_id = cur.company_id
        and prior.plant = cur.plant
        and prior.account_group = cur.account_group
        and prior.month < cur.month
    )
  group by cur.plant, cur.account_group
  having sum(cur.amount) <> 0;
$$;
