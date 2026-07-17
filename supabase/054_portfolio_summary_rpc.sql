-- Migration 054: Portfolio summary RPC function
-- Replaces the unbounded price_history fetch on home + executive pages.
-- Instead of downloading all historical prices to the browser and deduplicating
-- in JS, this function finds the most recent price per ticker on or before a
-- given date entirely in Postgres, joins with holdings, and returns one summary
-- row per ticker.
--
-- Apply manually in Supabase SQL Editor. No tables are modified.

create or replace function get_portfolio_summary_as_of(as_of date)
returns table (
  ticker          text,
  company_name    text,
  total_qty       numeric,
  total_cost      numeric,
  avg_cost        numeric,
  current_price   numeric,
  price_date      date,
  current_value   numeric,
  gain_loss       numeric,
  gain_loss_pct   numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with latest_prices as (
    -- One row per ticker: the most recent price on or before the requested date.
    -- DISTINCT ON + ORDER BY is the same pattern already used by the current_prices view.
    select distinct on (ticker)
      ticker,
      price,
      as_of_date
    from price_history
    where as_of_date <= as_of
    order by ticker, as_of_date desc
  ),
  holding_totals as (
    -- Aggregate multiple buy lots per ticker into one row.
    select
      ticker,
      max(company_name)                          as company_name,
      sum(quantity)                              as total_qty,
      sum(quantity * buy_price)                  as total_cost,
      sum(quantity * buy_price) / nullif(sum(quantity), 0) as avg_cost
    from holdings
    group by ticker
  )
  select
    h.ticker,
    h.company_name,
    h.total_qty,
    h.total_cost,
    h.avg_cost,
    p.price                                      as current_price,
    p.as_of_date                                 as price_date,
    h.total_qty * p.price                        as current_value,
    h.total_qty * p.price - h.total_cost         as gain_loss,
    case when h.total_cost > 0
      then (h.total_qty * p.price - h.total_cost) / h.total_cost * 100
      else 0
    end                                          as gain_loss_pct
  from holding_totals h
  left join latest_prices p on p.ticker = h.ticker
  order by h.ticker;
$$;

-- Allow authenticated users to call this function (RLS on the underlying
-- tables already restricts who can read holdings/price_history).
grant execute on function get_portfolio_summary_as_of(date) to authenticated;
