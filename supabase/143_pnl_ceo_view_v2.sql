-- CEO view v2 (17/07/2026) — plant-aware RPCs so the page's plant filter
-- changes EVERY number, not just the expense breakdown (Khuram's feedback on
-- the first version). Three changes:
--
--   1. pnl_kpi_summary_plant — same 8 lines as pnl_kpi_summary but with a
--      p_plant filter ('All' = the 4 plants combined, else that one plant).
--   2. pnl_cost_structure gains p_plant (default 'All'). The old 3-argument
--      version is dropped first so Supabase RPC calls are never ambiguous.
--   3. pnl_plant_scoreboard — one row per plant for the scoreboard table:
--      sales, GP and net profit over the selected range.
--
-- All read-only, security definer + fixed search_path, all aggregation in
-- Postgres per rule 0. Apply manually via the Supabase SQL Editor after 142.

create or replace function pnl_kpi_summary_plant(p_company_id uuid, p_from date, p_to date, p_plant text default 'All')
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
    and month between p_from and p_to
    and case when p_plant = 'All'
         then plant in ('FEDMIC', 'MEPCO', 'PESCO', 'HO')
         else plant = p_plant
        end
  group by month
  order by month;
$$;

drop function if exists pnl_cost_structure(uuid, date, date);

create or replace function pnl_cost_structure(p_company_id uuid, p_from date, p_to date, p_plant text default 'All')
returns table (month date, bucket text, amount numeric)
security definer
set search_path = public
language sql
as $$
  select
    month,
    case
      when account_group like 'Admin-%' or account_group = 'Computer and Internet Expense' then 'Admin'
      when account_group like 'S&D%' then 'Selling & distribution'
      when account_group in ('Bank Charges', 'Interest') then 'Finance costs'
      when account_group in ('Misc Income', 'Sale of Material') then 'Other income'
      when account_group = 'Misc Expenses' then 'Other expenses'
      else 'Production / COGS'
    end as bucket,
    sum(amount) as amount
  from pnl_ledger_lines
  where company_id = p_company_id
    and month between p_from and p_to
    and account_group not in ('Gross Sales', 'Taxation')
    and (p_plant = 'All' or plant = p_plant)
  group by 1, 2
  order by 1, 2;
$$;

create or replace function pnl_plant_scoreboard(p_company_id uuid, p_from date, p_to date)
returns table (plant text, gross_sale numeric, gross_profit numeric, net_profit numeric)
security definer
set search_path = public
language sql
as $$
  select
    plant,
    sum(amount) filter (where line = 'Gross Sale')       as gross_sale,
    sum(amount) filter (where line = 'GP')               as gross_profit,
    sum(amount) filter (where line = 'Net Profit Final') as net_profit
  from pnl_line_items
  where company_id = p_company_id
    and plant in ('FEDMIC', 'MEPCO', 'PESCO', 'HO')
    and month between p_from and p_to
  group by plant
  order by plant;
$$;
