-- ============================================================
-- 034: Investment portfolio tracking (PSX stocks)
-- ============================================================

-- Holdings: each row = one buy lot
create table if not exists holdings (
  id         uuid primary key default gen_random_uuid(),
  ticker     text not null,
  company_name text,
  quantity   numeric not null,
  buy_price  numeric not null,        -- per-share cost
  buy_date   date,
  target_price numeric,               -- sell target per share
  notes      text,
  created_at timestamptz default now()
);

-- Daily price snapshots
create table if not exists price_history (
  id         uuid primary key default gen_random_uuid(),
  ticker     text not null,
  price      numeric not null,
  as_of_date date not null,
  source     text default 'manual',   -- 'psx_dps', 'yahoo', 'manual'
  created_at timestamptz default now(),
  unique (ticker, as_of_date)         -- one price per ticker per day
);

-- Materialised "latest price" view for fast reads
create or replace view current_prices as
select distinct on (ticker)
  ticker,
  price,
  as_of_date,
  source
from price_history
order by ticker, as_of_date desc, created_at desc;

-- Portfolio summary view (joins holdings with latest prices)
create or replace view portfolio_summary as
select
  h.ticker,
  h.company_name,
  sum(h.quantity)                                          as total_qty,
  sum(h.quantity * h.buy_price) / nullif(sum(h.quantity), 0) as avg_cost,
  sum(h.quantity * h.buy_price)                            as total_cost,
  cp.price                                                 as current_price,
  cp.as_of_date                                            as price_date,
  cp.source                                                as price_source,
  sum(h.quantity) * cp.price                               as current_value,
  sum(h.quantity) * cp.price - sum(h.quantity * h.buy_price) as gain_loss,
  case when sum(h.quantity * h.buy_price) > 0
    then (sum(h.quantity) * cp.price - sum(h.quantity * h.buy_price))
         / sum(h.quantity * h.buy_price) * 100
    else 0
  end                                                      as gain_loss_pct,
  max(h.target_price)                                      as target_price
from holdings h
left join current_prices cp on cp.ticker = h.ticker
group by h.ticker, h.company_name, cp.price, cp.as_of_date, cp.source;

-- RLS
alter table holdings enable row level security;
alter table price_history enable row level security;

create policy "Authenticated users can read holdings"
  on holdings for select to authenticated using (true);

create policy "Authenticated users can insert holdings"
  on holdings for insert to authenticated with check (true);

create policy "Authenticated users can update holdings"
  on holdings for update to authenticated using (true);

create policy "Authenticated users can delete holdings"
  on holdings for delete to authenticated using (true);

create policy "Authenticated users can read price_history"
  on price_history for select to authenticated using (true);

create policy "Authenticated users can insert price_history"
  on price_history for insert to authenticated with check (true);

create policy "Authenticated users can update price_history"
  on price_history for update to authenticated using (true);

create policy "Service role full access holdings"
  on holdings for all to service_role using (true);

create policy "Service role full access price_history"
  on price_history for all to service_role using (true);

-- Index for fast price lookups
create index if not exists idx_price_history_ticker_date
  on price_history (ticker, as_of_date desc);

create index if not exists idx_holdings_ticker
  on holdings (ticker);
