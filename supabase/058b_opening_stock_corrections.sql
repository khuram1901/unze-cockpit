-- Data corrections: PESCO and MEPCO opening stock as at 30/06/2026
-- Run AFTER migration 058 (which adds qty_40 columns).
-- Apply manually via Supabase SQL Editor.

-- ── 1. PESCO: create PO #1037-44 ─────────────────────────────────
-- Ordered quantities are the same as the unlifted stock (full PO scope unknown,
-- so setting ordered = unlifted as a minimum — update if you have the full PO qty).
insert into purchase_orders (
  plant_id, plant_name, customer_name, po_number, po_label,
  ordered_31, ordered_36, ordered_45,
  status, is_system_unallocated
)
values (
  'b2d0782c-e468-4a09-8c7d-6583d799d45b',
  'PESCO',
  'PESCO',
  '1037-44',
  'PC Spun Poles 31ft / 36ft / 45ft',
  18212, 11442, 8748,
  'Active', false
)
on conflict (plant_id, po_number) do nothing;

-- ── 2. PESCO: set opening stock allocation ────────────────────────
insert into opening_stock_allocations (
  plant_id, po_id, as_of_date, qty_31, qty_36, qty_45, set_by
)
select
  'b2d0782c-e468-4a09-8c7d-6583d799d45b',
  id,
  '2026-06-30',
  18212, 11442, 8748,
  'system-correction'
from purchase_orders
where plant_id = 'b2d0782c-e468-4a09-8c7d-6583d799d45b'
  and po_number = '1037-44'
on conflict (plant_id, po_id) do update
  set qty_31 = 18212, qty_36 = 11442, qty_45 = 8748, as_of_date = '2026-06-30';

-- ── 3. MEPCO: create PO #406-14 (40ft poles) ─────────────────────
insert into purchase_orders (
  plant_id, plant_name, customer_name, po_number, po_label,
  ordered_40,
  status, is_system_unallocated
)
values (
  'e6a84be7-0393-4072-a6d7-e91643b79c93',
  'MEPCO',
  'MEPCO',
  '406-14',
  'PC Spun Poles 40ft',
  33,
  'Active', false
)
on conflict (plant_id, po_number) do nothing;

-- ── 4. MEPCO PO #406-14: set opening stock allocation ────────────
insert into opening_stock_allocations (
  plant_id, po_id, as_of_date, qty_40, set_by
)
select
  'e6a84be7-0393-4072-a6d7-e91643b79c93',
  id,
  '2026-06-30',
  33,
  'system-correction'
from purchase_orders
where plant_id = 'e6a84be7-0393-4072-a6d7-e91643b79c93'
  and po_number = '406-14'
on conflict (plant_id, po_id) do update
  set qty_40 = 33, as_of_date = '2026-06-30';

-- ── 5. MEPCO PO #4640: correct opening allocation date ───────────
-- Already has the right quantities (3498/5404/1276), just fix the date to 30/06/2026
update opening_stock_allocations
set as_of_date = '2026-06-30'
where plant_id = 'e6a84be7-0393-4072-a6d7-e91643b79c93'
  and po_id = 'ba3b13c2-d723-49c6-9184-fbdb4787885c';
