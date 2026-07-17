-- Replaces the P&L RPCs from 139_pnl_rpcs.sql. Two fixes, both found while
-- building the parser against a real file:
--
-- 1. Line-name mismatch: 139's RPCs assumed clean labels like
--    'Operating Expenses-Admin&Selling'. The real file has quirks (a typo —
--    "Operationg" not "Operating" — plus inconsistent ampersand spacing).
--    The parser now stores clean, canonical names (see
--    app/lib/excel-parsers/pnl-unze-parser.ts), and these RPCs are updated
--    to match: 'Gross Sale', 'Total Cost of Sale', 'GP', 'Operating
--    Expenses', 'Taxation', 'Net Profit After Tax', 'Non Operating Income
--    and Exp', 'Net Profit Final'.
--
-- 2. HO exclusion: the file's own "Total" column is FEDMIC + MEPCO + PESCO
--    only — HO (Head Office) is a real cost sitting outside it. Company-wide
--    KPI totals now sum all 4 plants directly instead of reading "Total".
--    Per-plant views (segment breakdown, overheads drill-down) gain a
--    p_allocate_ho toggle: false shows HO as its own bucket ("as reported"),
--    true spreads HO's amount into FEDMIC/MEPCO/PESCO by that month's Share
--    Allocation % from pnl_allocation_pct ("allocated to plants"). Computed
--    on read, nothing stored twice.
--
-- Apply manually via the Supabase SQL Editor, after 138 and 139 — do not
-- auto-run.

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
    sum(amount) filter (where line = 'Gross Sale')                       as gross_sale,
    sum(amount) filter (where line = 'Total Cost of Sale')               as cost_of_sale,
    sum(amount) filter (where line = 'GP')                               as gross_profit,
    sum(amount) filter (where line = 'Operating Expenses')               as operating_expenses,
    sum(amount) filter (where line = 'Taxation')                         as taxation,
    sum(amount) filter (where line = 'Net Profit After Tax')             as net_profit_after_tax,
    sum(amount) filter (where line = 'Non Operating Income and Exp')     as non_operating,
    sum(amount) filter (where line = 'Net Profit Final')                 as net_profit_final
  from pnl_line_items
  where company_id = p_company_id
    and plant in ('FEDMIC', 'MEPCO', 'PESCO', 'HO')
    and month between p_from and p_to
  group by month
  order by month;
$$;

create or replace function pnl_segment_breakdown(p_company_id uuid, p_month date, p_allocate_ho boolean default false)
returns table (plant text, gross_profit numeric)
security definer
set search_path = public
language sql
as $$
  with raw as (
    select plant, sum(amount) as gross_profit
    from pnl_line_items
    where company_id = p_company_id and month = p_month and line = 'GP'
      and plant in ('FEDMIC', 'MEPCO', 'PESCO', 'HO')
    group by plant
  ),
  ho as (
    select gross_profit as ho_gp from raw where plant = 'HO'
  )
  select r.plant, r.gross_profit
  from raw r
  where not p_allocate_ho
  union all
  select r.plant, r.gross_profit + coalesce(a.pct, 0) / 100.0 * coalesce((select ho_gp from ho), 0)
  from raw r
  left join pnl_allocation_pct a on a.company_id = p_company_id and a.month = p_month and a.plant = r.plant
  where p_allocate_ho and r.plant <> 'HO'
  order by plant;
$$;

create or replace function pnl_overheads_breakdown(p_company_id uuid, p_plant text, p_from date, p_to date, p_allocate_ho boolean default false)
returns table (month date, plant text, account_group text, amount numeric)
security definer
set search_path = public
language sql
as $$
  with raw as (
    select month, plant, account_group, sum(amount) as amount
    from pnl_ledger_lines
    where company_id = p_company_id and month between p_from and p_to
    group by month, plant, account_group
  ),
  ho as (
    select month, account_group, amount as ho_amount from raw where plant = 'HO'
  )
  select month, plant, account_group, amount
  from raw
  where not p_allocate_ho and plant <> 'HO'
    and (p_plant = 'All plants' or plant = p_plant)
  union all
  select month, plant, account_group, amount
  from raw
  where not p_allocate_ho and plant = 'HO'
    and (p_plant = 'All plants' or plant = p_plant)
  union all
  select r.month, r.plant, r.account_group,
    r.amount + coalesce(a.pct, 0) / 100.0 * coalesce(h.ho_amount, 0)
  from raw r
  left join ho h on h.month = r.month and h.account_group = r.account_group
  left join pnl_allocation_pct a on a.company_id = p_company_id and a.month = r.month and a.plant = r.plant
  where p_allocate_ho and r.plant <> 'HO'
    and (p_plant = 'All plants' or r.plant = p_plant)
  order by month, account_group, plant;
$$;

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
       where company_id = p_company_id and plant in ('FEDMIC','MEPCO','PESCO','HO') and line = 'Gross Sale'
         and month between bounds.year_start and p_month),
    (select sum(amount) from pnl_line_items, bounds
       where company_id = p_company_id and plant in ('FEDMIC','MEPCO','PESCO','HO') and line = 'Gross Sale'
         and month between bounds.year_start - interval '1 year' and p_month - interval '1 year'),
    (select sum(amount) from pnl_line_items, bounds
       where company_id = p_company_id and plant in ('FEDMIC','MEPCO','PESCO','HO') and line = 'GP'
         and month between bounds.year_start and p_month),
    (select sum(amount) from pnl_line_items, bounds
       where company_id = p_company_id and plant in ('FEDMIC','MEPCO','PESCO','HO') and line = 'GP'
         and month between bounds.year_start - interval '1 year' and p_month - interval '1 year');
$$;

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
    sum(amount) filter (where line = 'Gross Sale'),
    sum(amount) filter (where line = 'Total Cost of Sale'),
    sum(amount) filter (where line = 'Operating Expenses'),
    sum(amount) filter (where line = 'Taxation'),
    sum(amount) filter (where line = 'Net Profit After Tax')
  from pnl_line_items
  where company_id = p_company_id
    and plant in ('FEDMIC', 'MEPCO', 'PESCO', 'HO')
    and month in (p_month, (p_month - interval '1 month')::date)
  group by month
  order by month;
$$;
-- pnl_new_account_flags is unchanged from 139 — no line-name or HO
-- assumptions in it, nothing to fix.
