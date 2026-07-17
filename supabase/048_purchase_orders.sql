-- Migration 048: Multi-customer PO / warehouse stock tracking
-- Apply via Supabase SQL Editor (never auto-run from CLI).
--
-- Hierarchy: Plant → PurchaseOrder → Contractor → AuthorityLetter → DispatchRecord
-- Production entries are linked to POs via production_allocations.

-- ─────────────────────────────────────────────────────────────────
-- 1. PURCHASE ORDERS
-- ─────────────────────────────────────────────────────────────────
create table if not exists purchase_orders (
  id                  uuid primary key default gen_random_uuid(),
  plant_id            uuid not null references plants(id) on delete restrict,
  plant_name          text not null,
  customer_name       text not null,
  po_number           text not null,
  po_label            text not null default '',         -- e.g. "Old PO", "1st Year PO with 15% Repeat"
  ordered_31          numeric not null default 0,
  ordered_36          numeric not null default 0,
  ordered_45          numeric not null default 0,
  ordered_meter       numeric not null default 0,
  variance_pct        numeric not null default 3,       -- allowed overproduction buffer (%)
  status              text not null default 'Active'
                        check (status in ('Active', 'Closed')),
  is_system_unallocated boolean not null default false, -- auto-created per plant, cannot be deleted/closed
  start_date          date,
  notes               text,
  created_by          text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  -- Backfill: manually entered totals for pre-go-live history
  opening_produced_31  numeric not null default 0,
  opening_produced_36  numeric not null default 0,
  opening_produced_45  numeric not null default 0,
  opening_produced_meter numeric not null default 0,
  constraint purchase_orders_po_number_plant_unique unique (plant_id, po_number)
);

create index if not exists po_plant_idx on purchase_orders (plant_id, status);

-- ─────────────────────────────────────────────────────────────────
-- 2. PRODUCTION ALLOCATIONS
-- Links a production_entries row to one or more POs.
-- Sum of allocations per entry <= entry total (enforced at app level).
-- ─────────────────────────────────────────────────────────────────
create table if not exists production_allocations (
  id                    uuid primary key default gen_random_uuid(),
  production_entry_id   uuid not null references production_entries(id) on delete cascade,
  po_id                 uuid not null references purchase_orders(id) on delete restrict,
  qty_31                numeric not null default 0,
  qty_36                numeric not null default 0,
  qty_45                numeric not null default 0,
  qty_meter             numeric not null default 0,
  created_at            timestamptz default now(),
  constraint production_allocations_entry_po_unique unique (production_entry_id, po_id)
);

create index if not exists prod_alloc_po_idx on production_allocations (po_id);

-- ─────────────────────────────────────────────────────────────────
-- 3. CONTRACTORS
-- Reusable across POs and plants.
-- ─────────────────────────────────────────────────────────────────
create table if not exists contractors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  cnic_or_id    text,
  contact_phone text,
  contact_address text,
  notes         text,
  created_by    text,
  created_at    timestamptz default now()
);

create index if not exists contractors_name_idx on contractors (lower(name));

-- Junction: which contractors are linked to which PO
create table if not exists po_contractors (
  id            uuid primary key default gen_random_uuid(),
  po_id         uuid not null references purchase_orders(id) on delete cascade,
  contractor_id uuid not null references contractors(id) on delete restrict,
  created_at    timestamptz default now(),
  constraint po_contractors_unique unique (po_id, contractor_id)
);

-- ─────────────────────────────────────────────────────────────────
-- 4. AUTHORITY LETTERS
-- One contractor can have multiple letters under a PO.
-- Sum of all letters' qty for a PO <= PO ordered qty (enforced at app level).
-- Backfill field: already_dispatched_* for pre-go-live pickups against this letter.
-- ─────────────────────────────────────────────────────────────────
create table if not exists authority_letters (
  id              uuid primary key default gen_random_uuid(),
  po_id           uuid not null references purchase_orders(id) on delete restrict,
  contractor_id   uuid not null references contractors(id) on delete restrict,
  letter_number   text not null,
  issue_date      date not null,
  issued_by       text not null,                        -- name of person who issued it (MEPCO-side)
  qty_31          numeric not null default 0,
  qty_36          numeric not null default 0,
  qty_45          numeric not null default 0,
  qty_meter       numeric not null default 0,
  -- Backfill: pre-go-live dispatches already made against this letter
  opening_dispatched_31    numeric not null default 0,
  opening_dispatched_36    numeric not null default 0,
  opening_dispatched_45    numeric not null default 0,
  opening_dispatched_meter numeric not null default 0,
  notes           text,
  created_by      text,
  created_at      timestamptz default now(),
  constraint authority_letters_number_po_unique unique (po_id, letter_number)
);

create index if not exists auth_letters_po_idx on authority_letters (po_id);
create index if not exists auth_letters_contractor_idx on authority_letters (contractor_id);

-- ─────────────────────────────────────────────────────────────────
-- 5. DISPATCH RECORDS (individual pickups against an authority letter)
-- ─────────────────────────────────────────────────────────────────
create table if not exists dispatch_records (
  id                  uuid primary key default gen_random_uuid(),
  authority_letter_id uuid not null references authority_letters(id) on delete restrict,
  dispatch_date       date not null default current_date,
  qty_31              numeric not null default 0,
  qty_36              numeric not null default 0,
  qty_45              numeric not null default 0,
  qty_meter           numeric not null default 0,
  released_by         text not null,                    -- plant staff member who released the stock
  vehicle_number      text,
  notes               text,
  created_by          text,
  created_at          timestamptz default now()
);

create index if not exists dispatch_records_letter_idx on dispatch_records (authority_letter_id);
create index if not exists dispatch_records_date_idx   on dispatch_records (dispatch_date);

-- ─────────────────────────────────────────────────────────────────
-- 6. RLS
-- ─────────────────────────────────────────────────────────────────

alter table purchase_orders      enable row level security;
alter table production_allocations enable row level security;
alter table contractors          enable row level security;
alter table po_contractors       enable row level security;
alter table authority_letters    enable row level security;
alter table dispatch_records     enable row level security;

-- Service role: full access everywhere
create policy "po_service"   on purchase_orders      for all to service_role using (true) with check (true);
create policy "pa_service"   on production_allocations for all to service_role using (true) with check (true);
create policy "con_service"  on contractors          for all to service_role using (true) with check (true);
create policy "poc_service"  on po_contractors       for all to service_role using (true) with check (true);
create policy "al_service"   on authority_letters    for all to service_role using (true) with check (true);
create policy "dr_service"   on dispatch_records     for all to service_role using (true) with check (true);

-- Authenticated: read everything (plant members need to read POs and letters to log entries)
create policy "po_read"   on purchase_orders      for select to authenticated using (true);
create policy "pa_read"   on production_allocations for select to authenticated using (true);
create policy "con_read"  on contractors          for select to authenticated using (true);
create policy "poc_read"  on po_contractors       for select to authenticated using (true);
create policy "al_read"   on authority_letters    for select to authenticated using (true);
create policy "dr_read"   on dispatch_records     for select to authenticated using (true);

-- Write: ops dept + admin/exec can insert/update/delete
-- (More granular app-level checks enforce manager-only for PO creation)
create policy "po_write"  on purchase_orders      for all to authenticated
  using (is_admin_or_exec() or get_user_role() = 'Manager')
  with check (is_admin_or_exec() or get_user_role() = 'Manager');

create policy "pa_write"  on production_allocations for all to authenticated
  using (true) with check (true);   -- any authenticated plant member can allocate

create policy "con_write" on contractors          for all to authenticated
  using (is_admin_or_exec() or get_user_role() = 'Manager')
  with check (is_admin_or_exec() or get_user_role() = 'Manager');

create policy "poc_write" on po_contractors       for all to authenticated
  using (is_admin_or_exec() or get_user_role() = 'Manager')
  with check (is_admin_or_exec() or get_user_role() = 'Manager');

create policy "al_write"  on authority_letters    for all to authenticated
  using (is_admin_or_exec() or get_user_role() = 'Manager')
  with check (is_admin_or_exec() or get_user_role() = 'Manager');

create policy "dr_write"  on dispatch_records     for all to authenticated
  using (true) with check (true);   -- any authenticated plant member can log a pickup

-- ─────────────────────────────────────────────────────────────────
-- 7. AUTO-CREATE system "Unze Owned / Unallocated" PO for each existing plant
-- ─────────────────────────────────────────────────────────────────
insert into purchase_orders (plant_id, plant_name, customer_name, po_number, po_label, is_system_unallocated, ordered_31, ordered_36, ordered_45, ordered_meter)
select
  p.id,
  p.name,
  'Unze (Internal)',
  'UNZE-UNALLOCATED-' || p.id,
  'Unallocated / Balance from Inspection',
  true,
  0, 0, 0, 0
from plants p
where p.active = true
  and not exists (
    select 1 from purchase_orders po
    where po.plant_id = p.id and po.is_system_unallocated = true
  );
