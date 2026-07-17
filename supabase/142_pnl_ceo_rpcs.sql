-- CEO view RPCs for the upgraded Profit & Loss page (17/07/2026).
-- Three new read-only functions — nothing existing is touched:
--
--   1. pnl_plant_margin_trend  — month x plant sales/GP so the page can draw
--      per-plant margin lines (FEDMIC vs MEPCO vs PESCO over time).
--   2. pnl_cost_structure      — monthly cost buckets (production/COGS, admin,
--      selling, finance, other) mapped from ledger account groups, so the page
--      can show cost as % of sales without summing ledger rows in JS.
--   3. pnl_validation_summary  — one row per month from pnl_uploads: file,
--      status, checks passed/failed. Powers the data-quality card.
--
-- All aggregation in Postgres per the house rule. Apply manually via the
-- Supabase SQL Editor, after 138-141 — do not auto-run.

create or replace function pnl_plant_margin_trend(p_company_id uuid, p_from date, p_to date)
returns table (month date, plant text, gross_sale numeric, gross_profit numeric)
security definer
set search_path = public
language sql
as $$
  select
    month,
    plant,
    sum(amount) filter (where line = 'Gross Sale')  as gross_sale,
    sum(amount) filter (where line = 'GP')          as gross_profit
  from pnl_line_items
  where company_id = p_company_id
    and plant in ('FEDMIC', 'MEPCO', 'PESCO')
    and month between p_from and p_to
  group by month, plant
  order by month, plant;
$$;

-- Bucket mapping is deliberately pattern-based so new account groups land in
-- a sensible bucket instead of disappearing:
--   Admin-% and Computer/Internet          -> Admin
--   S&D-%                                  -> Selling & distribution
--   Bank Charges, Interest                 -> Finance costs
--   Misc Income, Sale of Material          -> Other income (negative = income)
--   Misc Expenses                          -> Other expenses
--   Gross Sales, Taxation                  -> excluded (not operating costs)
--   everything else                        -> Production / COGS
create or replace function pnl_cost_structure(p_company_id uuid, p_from date, p_to date)
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
  group by 1, 2
  order by 1, 2;
$$;

create or replace function pnl_validation_summary(p_company_id uuid)
returns table (
  month date,
  file_name text,
  status text,
  checks_passed integer,
  checks_failed integer,
  uploaded_at timestamptz
)
security definer
set search_path = public
language sql
as $$
  select distinct on (month)
    month, file_name, status, checks_passed, checks_failed, uploaded_at
  from pnl_uploads
  where company_id = p_company_id
  order by month, uploaded_at desc;
$$;
