-- Migration 065: Stock dividends table
-- Apply manually via Supabase SQL Editor AFTER 064.

create table if not exists stock_dividends (
  id                uuid primary key default gen_random_uuid(),
  ticker            text not null,
  dividend_per_share numeric(12,4) not null,
  ex_dividend_date  date not null,
  payment_date      date,
  announced_date    date,
  status            text not null default 'upcoming'
                    check (status in ('upcoming', 'paid', 'cancelled')),
  source            text not null default 'manual'
                    check (source in ('manual', 'auto-psx', 'auto-company-site')),
  confirmed         boolean not null default false,
  notes             text,
  entered_by        text,
  entered_at        timestamptz default now(),
  unique (ticker, ex_dividend_date)
);

-- Index for the most common query: upcoming dividends in date window
create index if not exists idx_stock_dividends_ex_date
  on stock_dividends (ex_dividend_date, status, confirmed);

-- Index for ticker lookups
create index if not exists idx_stock_dividends_ticker
  on stock_dividends (ticker);

-- RLS: authenticated users can read; service role manages writes
alter table stock_dividends enable row level security;

create policy "authenticated_read_dividends"
  on stock_dividends for select
  to authenticated
  using (true);

-- Service role (API routes) handles all inserts/updates/deletes via createServiceClient()

-- RPC: upcoming dividends joined with holdings so we know our estimated payout
-- Returns confirmed and unconfirmed rows separately via the confirmed column.
-- Caller filters by confirmed to show the two lists.
create or replace function get_upcoming_dividends(p_days_ahead int default 14)
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
    d.status = 'upcoming'
    and d.ex_dividend_date >= current_date
    and d.ex_dividend_date <= current_date + p_days_ahead
  order by d.ex_dividend_date, d.ticker;
$$;

grant execute on function get_upcoming_dividends(int) to authenticated;
