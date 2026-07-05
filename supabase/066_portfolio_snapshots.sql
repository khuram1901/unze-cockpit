-- Migration 066: Portfolio snapshots + daily summary RPC
-- Apply manually via Supabase SQL Editor AFTER 065.

-- ── 1. Portfolio snapshots table ──────────────────────────────────────────────
-- One row per ticker per day, written by the daily-summary cron.
-- Lets the investments page show day-on-day movement (today vs yesterday).

create table if not exists portfolio_snapshots (
  id            uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  ticker        text not null,
  total_qty     numeric,
  total_cost    numeric,
  current_price numeric,
  current_value numeric,
  gain_loss     numeric,
  gain_loss_pct numeric,
  created_at    timestamptz default now(),
  unique (snapshot_date, ticker)
);

create index if not exists idx_portfolio_snapshots_date
  on portfolio_snapshots (snapshot_date desc, ticker);

alter table portfolio_snapshots enable row level security;

create policy "authenticated_read_snapshots"
  on portfolio_snapshots for select
  to authenticated
  using (true);


-- ── 2. Daily summary RPC ──────────────────────────────────────────────────────
-- Returns one JSON object with:
--   totals      { total_cost, total_value, gain_loss, gain_loss_pct,
--                 prev_value, day_change, day_change_pct, stock_count }
--   stocks      [ { ticker, company_name, … gain_loss_pct } ]  -- all stocks
--   alerts      [ stocks where gain_loss_pct <= threshold ]
--   best        { ticker, gain_loss_pct }
--   worst       { ticker, gain_loss_pct }
--   dividends   { confirmed: [...], unconfirmed: [...] }  -- next 14 days
--
-- p_as_of       : date to compute portfolio value (normally today)
-- p_prev_date   : date to compare against (normally yesterday)
-- p_alert_pct   : threshold below which a stock is flagged (e.g. -3)
-- p_div_days    : dividend look-ahead window in days (e.g. 14)

create or replace function get_portfolio_daily_summary(
  p_as_of      date    default current_date,
  p_prev_date  date    default current_date - 1,
  p_alert_pct  numeric default -3,
  p_div_days   int     default 14
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  with
  -- Current portfolio snapshot (reuses get_portfolio_summary_as_of logic inline)
  latest_prices as (
    select distinct on (ticker)
      ticker, price, as_of_date
    from price_history
    where as_of_date <= p_as_of
    order by ticker, as_of_date desc
  ),
  holding_totals as (
    select
      ticker,
      max(company_name)                                        as company_name,
      sum(quantity)                                            as total_qty,
      sum(quantity * buy_price)                                as total_cost,
      sum(quantity * buy_price) / nullif(sum(quantity), 0)    as avg_cost
    from holdings
    group by ticker
  ),
  current_stocks as (
    select
      h.ticker,
      h.company_name,
      h.total_qty,
      h.total_cost,
      h.avg_cost,
      p.price                                                  as current_price,
      p.as_of_date                                             as price_date,
      h.total_qty * p.price                                    as current_value,
      h.total_qty * p.price - h.total_cost                    as gain_loss,
      case when h.total_cost > 0
        then (h.total_qty * p.price - h.total_cost) / h.total_cost * 100
        else 0
      end                                                      as gain_loss_pct
    from holding_totals h
    left join latest_prices p on p.ticker = h.ticker
  ),
  -- Previous day totals (from snapshots if available, else re-compute)
  prev_prices as (
    select distinct on (ticker)
      ticker, price
    from price_history
    where as_of_date <= p_prev_date
    order by ticker, as_of_date desc
  ),
  prev_value_calc as (
    select coalesce(sum(h.total_qty * p.price), 0) as prev_value
    from holding_totals h
    left join prev_prices p on p.ticker = h.ticker
  ),
  -- Dividends in window
  div_upcoming as (
    select
      d.id, d.ticker, d.dividend_per_share,
      d.ex_dividend_date, d.payment_date,
      d.confirmed, d.source,
      coalesce(h.total_qty, 0)                              as total_qty,
      coalesce(h.total_qty, 0) * d.dividend_per_share       as estimated_payout,
      (d.ex_dividend_date - p_as_of)::int                   as days_to_ex
    from stock_dividends d
    left join (
      select ticker, sum(quantity) as total_qty from holdings group by ticker
    ) h on h.ticker = d.ticker
    where d.status = 'upcoming'
      and d.ex_dividend_date >= p_as_of
      and d.ex_dividend_date <= p_as_of + p_div_days
  )
  select jsonb_build_object(
    'as_of',      p_as_of,
    'prev_date',  p_prev_date,
    'totals', (
      select jsonb_build_object(
        'total_cost',       coalesce(sum(total_cost), 0),
        'total_value',      coalesce(sum(current_value), 0),
        'gain_loss',        coalesce(sum(gain_loss), 0),
        'gain_loss_pct',    case when coalesce(sum(total_cost), 0) > 0
                              then (coalesce(sum(current_value), 0) - coalesce(sum(total_cost), 0))
                                   / coalesce(sum(total_cost), 0) * 100
                              else 0 end,
        'prev_value',       (select prev_value from prev_value_calc),
        'day_change',       coalesce(sum(current_value), 0) - (select prev_value from prev_value_calc),
        'day_change_pct',   case when (select prev_value from prev_value_calc) > 0
                              then (coalesce(sum(current_value), 0) - (select prev_value from prev_value_calc))
                                   / (select prev_value from prev_value_calc) * 100
                              else 0 end,
        'stock_count',      count(*)
      ) from current_stocks
    ),
    'stocks', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'ticker',        ticker,
        'company_name',  company_name,
        'total_qty',     total_qty,
        'total_cost',    total_cost,
        'current_price', current_price,
        'current_value', current_value,
        'gain_loss',     gain_loss,
        'gain_loss_pct', gain_loss_pct,
        'price_date',    price_date
      ) order by gain_loss_pct desc nulls last), '[]'::jsonb)
      from current_stocks
    ),
    'alerts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'ticker',        ticker,
        'company_name',  company_name,
        'gain_loss_pct', gain_loss_pct,
        'gain_loss',     gain_loss,
        'current_value', current_value
      ) order by gain_loss_pct asc), '[]'::jsonb)
      from current_stocks
      where gain_loss_pct <= p_alert_pct
    ),
    'best', (
      select jsonb_build_object('ticker', ticker, 'company_name', company_name, 'gain_loss_pct', gain_loss_pct, 'gain_loss', gain_loss)
      from current_stocks order by gain_loss_pct desc nulls last limit 1
    ),
    'worst', (
      select jsonb_build_object('ticker', ticker, 'company_name', company_name, 'gain_loss_pct', gain_loss_pct, 'gain_loss', gain_loss)
      from current_stocks order by gain_loss_pct asc nulls last limit 1
    ),
    'dividends', jsonb_build_object(
      'confirmed',   coalesce((select jsonb_agg(jsonb_build_object(
                       'ticker', ticker, 'dividend_per_share', dividend_per_share,
                       'ex_dividend_date', ex_dividend_date, 'payment_date', payment_date,
                       'days_to_ex', days_to_ex, 'estimated_payout', estimated_payout
                     ) order by ex_dividend_date) from div_upcoming where confirmed = true), '[]'::jsonb),
      'unconfirmed', coalesce((select jsonb_agg(jsonb_build_object(
                       'ticker', ticker, 'dividend_per_share', dividend_per_share,
                       'ex_dividend_date', ex_dividend_date, 'days_to_ex', days_to_ex,
                       'source', source
                     ) order by ex_dividend_date) from div_upcoming where confirmed = false), '[]'::jsonb)
    )
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function get_portfolio_daily_summary(date, date, numeric, int) to authenticated;
