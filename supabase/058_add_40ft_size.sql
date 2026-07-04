-- Migration 058: Add 40ft pole size across all quantity tables
-- Apply manually via Supabase SQL Editor. Never auto-run.

alter table purchase_orders            add column if not exists ordered_40          numeric not null default 0;
alter table purchase_orders            add column if not exists opening_produced_40  numeric not null default 0;
alter table production_allocations     add column if not exists qty_40              numeric not null default 0;
alter table authority_letters          add column if not exists qty_40              numeric not null default 0;
alter table authority_letters          add column if not exists opening_dispatched_40 numeric not null default 0;
alter table dispatch_records           add column if not exists qty_40              numeric not null default 0;
alter table dispatch_entries           add column if not exists qty_40              numeric not null default 0;
alter table opening_stock_allocations  add column if not exists qty_40              numeric not null default 0;
alter table opening_balances           add column if not exists bal_40              numeric not null default 0;
alter table broken_opening_balances    add column if not exists bal_40              numeric not null default 0;
alter table breakage_entries           add column if not exists qty_40              numeric not null default 0;
alter table scrap_processed_entries    add column if not exists qty_40              numeric not null default 0;
alter table production_entries         add column if not exists qty_40              numeric not null default 0;
