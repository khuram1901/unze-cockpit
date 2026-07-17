-- Migration 057: Opening stock allocations per PO
-- Allows splitting a plant's opening balance across active POs.
-- The plant-level opening_balances table remains unchanged (used for ops KPI cards).
-- This table adds a PO-level layer on top so the Stock page can show correct per-PO stock.
--
-- Apply manually via Supabase SQL Editor. Never auto-run.

create table if not exists opening_stock_allocations (
  id          uuid primary key default gen_random_uuid(),
  plant_id    uuid not null references plants(id) on delete restrict,
  po_id       uuid not null references purchase_orders(id) on delete restrict,
  as_of_date  date not null,
  qty_31      numeric not null default 0,
  qty_36      numeric not null default 0,
  qty_45      numeric not null default 0,
  qty_meter   numeric not null default 0,
  set_by      text,
  created_at  timestamptz default now(),
  -- One allocation row per plant+PO combination (upsert on conflict)
  constraint opening_stock_allocations_plant_po_unique unique (plant_id, po_id)
);

create index if not exists osa_plant_idx on opening_stock_allocations (plant_id);
create index if not exists osa_po_idx    on opening_stock_allocations (po_id);

alter table opening_stock_allocations enable row level security;

-- Service role: full access
create policy "osa_service" on opening_stock_allocations
  for all to service_role using (true) with check (true);

-- Authenticated: read
create policy "osa_read" on opening_stock_allocations
  for select to authenticated using (true);

-- Write: admin/exec/manager only
create policy "osa_write" on opening_stock_allocations
  for all to authenticated
  using  (is_admin_or_exec() or get_user_role() = 'Manager')
  with check (is_admin_or_exec() or get_user_role() = 'Manager');
