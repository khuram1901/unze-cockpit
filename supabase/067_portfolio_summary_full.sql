-- Migration 067: Unified portfolio summary RPC
-- Replaces all JS-side aggregation on the investments page and executive dashboard.
-- One round-trip returns everything: per-ticker rows, totals, day-change,
-- losers list, latest price date, and confirmed dividend count.
--
-- p_as_of      : date to value the portfolio (normally today / selected date)
-- p_alert_pct  : loser threshold, e.g. -3 means stocks down more than 3%
-- p_div_days   : dividend look-ahead window in days for the count badge
--
-- Apply manually in Supabase SQL Editor AFTER 066.

create or replace function get_portfolio_summary_full(
  p_as_of      date    default current_date,
  p_alert_pct  numeric default -3,
  p_div_days   int     default 7
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  with
  -- Latest price per ticker on or before p_as_of
  latest_prices as (
    select distinct on (ticker)
      ticker, price, as_of_date
    from price_history
    where as_of_date <= p_as_of
    order by ticker, as_of_date desc
  ),
  -- Aggregate buy lots per ticker
  holding_totals as (
    select
      ticker,
      max(company_name)                                       as company_name,
      sum(quantity)                                           as total_qty,
      sum(quantity * buy_price)                               as total_cost,
      sum(quantity * buy_price) / nullif(sum(quantity), 0)   as avg_cost,
      max(target_price)                                       as target_price
    from holdings
    group by ticker
  ),
  -- Per-ticker current snapshot
  current_stocks as (
    select
      h.ticker,
      h.company_name,
      h.total_qty,
      h.total_cost,
      h.avg_cost,
      h.target_price,
      p.price                                                 as current_price,
      p.as_of_date                                            as price_date,
      h.total_qty * p.price                                   as current_value,
      h.total_qty * p.price - h.total_cost                   as gain_loss,
      case when h.total_cost > 0
        then (h.total_qty * p.price - h.total_cost) / h.total_cost * 100
        else 0
      end                                                     as gain_loss_pct
    from holding_totals h
    left join latest_prices p on p.ticker = h.ticker
  ),
  -- Previous day value: sum of current_value from yesterday's portfolio_snapshots
  prev_day as (
    select coalesce(sum(current_value), 0) as prev_value
    from portfolio_snapshots
    where snapshot_date = p_as_of - 1
  ),
  -- Portfolio-level totals
  totals as (
    select
      coalesce(sum(total_cost), 0)                            as total_cost,
      coalesce(sum(current_value), 0)                         as total_value,
      coalesce(sum(gain_loss), 0)                             as gain_loss,
      case when coalesce(sum(total_cost), 0) > 0
        then (coalesce(sum(gain_loss), 0) / coalesce(sum(total_cost), 0)) * 100
        else 0
      end                                                     as gain_loss_pct,
      count(*)                                                as stock_count,
      max(price_date)                                         as price_date
    from current_stocks
  ),
  -- Confirmed dividends due within the look-ahead window
  div_count as (
    select count(*) as confirmed_count
    from stock_dividends
    where confirmed = true
      and status    = 'upcoming'
      and ex_dividend_date >= p_as_of
      and ex_dividend_date <= p_as_of + p_div_days
  )
  select jsonb_build_object(
    'as_of',      p_as_of,
    'totals', (
      select jsonb_build_object(
        'total_cost',      t.total_cost,
        'total_value',     t.total_value,
        'gain_loss',       t.gain_loss,
        'gain_loss_pct',   t.gain_loss_pct,
        'stock_count',     t.stock_count,
        'price_date',      t.price_date,
        'prev_value',      (select prev_value from prev_day),
        'day_change',      t.total_value - (select prev_value from prev_day),
        'day_change_pct',  case when (select prev_value from prev_day) > 0
                             then (t.total_value - (select prev_value from prev_day))
                                  / (select prev_value from prev_day) * 100
                             else null
                           end,
        'dividend_count',  (select confirmed_count from div_count)
      ) from totals t
    ),
    'stocks', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'ticker',        ticker,
        'company_name',  company_name,
        'total_qty',     total_qty,
        'total_cost',    total_cost,
        'avg_cost',      avg_cost,
        'target_price',  target_price,
        'current_price', current_price,
        'price_date',    price_date,
        'current_value', current_value,
        'gain_loss',     gain_loss,
        'gain_loss_pct', gain_loss_pct
      ) order by ticker), '[]'::jsonb)
      from current_stocks
    ),
    'losers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'ticker',        ticker,
        'company_name',  company_name,
        'gain_loss_pct', gain_loss_pct,
        'gain_loss',     gain_loss
      ) order by gain_loss_pct asc), '[]'::jsonb)
      from current_stocks
      where gain_loss_pct <= p_alert_pct
    )
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function get_portfolio_summary_full(date, numeric, int) to authenticated;
