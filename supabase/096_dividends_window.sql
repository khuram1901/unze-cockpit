-- Migration 096: Widen the dividends window to include the recent past
-- Apply manually via Supabase SQL Editor.
--
-- Bug: get_upcoming_dividends only ever returned rows where
--   status = 'upcoming' AND ex_dividend_date >= current_date
-- The fetch-dividends cron marks a row 'paid' the moment its ex-dividend
-- date is in the past, so as soon as a dividend's ex-date passed, it
-- silently disappeared from the investments page and the PA widget —
-- even though it was fetched and sitting in the table the whole time.
-- That's why Khuram saw "no dividends" despite 9 rows already being
-- fetched (all dated April-May 2026, all status='paid', all invisible).
--
-- Fix: add a p_days_back parameter and drop the status='upcoming' filter
-- in favour of a plain date-range filter (still excluding 'cancelled').
-- Default p_days_back stays 0 so the two existing callers that don't
-- pass it (the PA dividend widget) see no behaviour change.

drop function if exists get_upcoming_dividends(int);

create or replace function get_upcoming_dividends(
  p_days_ahead int default 14,
  p_days_back  int default 0
)
returns table (
  id                uuid,
  ticker            text,
  dividend_per_share numeric,
  ex_dividend_date  date,
  payment_date      date,
  announced_date    date,
  status            text,
  source            text,
  confirmed         boolean,
  notes             text,
  entered_by        text,
  entered_at        timestamptz,
  total_qty         numeric,
  estimated_payout  numeric,
  days_to_ex        int
)
language sql
security definer
set search_path = public
as $$
  select
    d.id,
    d.ticker,
    d.dividend_per_share,
    d.ex_dividend_date,
    d.payment_date,
    d.announced_date,
    d.status,
    d.source,
    d.confirmed,
    d.notes,
    d.entered_by,
    d.entered_at,
    coalesce(h.total_qty, 0)                                    as total_qty,
    coalesce(h.total_qty, 0) * d.dividend_per_share             as estimated_payout,
    (d.ex_dividend_date - current_date)::int                    as days_to_ex
  from stock_dividends d
  left join (
    select ticker, sum(quantity) as total_qty
    from holdings
    group by ticker
  ) h on h.ticker = d.ticker
  where
    d.status <> 'cancelled'
    and d.ex_dividend_date >= current_date - p_days_back
    and d.ex_dividend_date <= current_date + p_days_ahead
  order by d.ex_dividend_date, d.ticker;
$$;

grant execute on function get_upcoming_dividends(int, int) to authenticated;
