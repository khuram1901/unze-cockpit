-- Phase 4 (tech debt, rule 0): move stock-module JS aggregation into Postgres.
-- Replaces the .reduce()/.filter() loops in:
--   app/api/stock/authority-letters (GET listAll, GET by letter number, PO cap validation)
--   app/api/stock/dispatch-records  (letter cap validation, PO auto-close)
--   app/api/stock/production-allocations (entry totals, PO produced totals)
-- Every function: security definer + set search_path = public, one round-trip.

-- ── 1. Sum of authority-letter quantities for a PO (cap validation) ─────────
-- Mirrors getPoLetterTotals() in authority-letters/route.ts: no openings,
-- sizes 31/36/45/meter only (letters cap is per-size against PO ordered qty).
create or replace function public.get_po_letter_totals(
  p_po_id uuid,
  p_exclude_letter_id uuid default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'qty_31',    coalesce(sum(qty_31),    0),
    'qty_36',    coalesce(sum(qty_36),    0),
    'qty_45',    coalesce(sum(qty_45),    0),
    'qty_meter', coalesce(sum(qty_meter), 0)
  )
  from authority_letters
  where po_id = p_po_id
    and (p_exclude_letter_id is null or id <> p_exclude_letter_id);
$$;

-- ── 2. Total dispatched against one letter (opening + records) ──────────────
-- Mirrors the reduce() in dispatch-records POST/PATCH. p_exclude_record_id
-- lets PATCH exclude the record being edited. Includes qty_40 (dispatch caps
-- check 40ft too).
create or replace function public.get_letter_dispatched_totals(
  p_letter_id uuid,
  p_exclude_record_id uuid default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'qty_31',    coalesce(al.opening_dispatched_31,    0) + coalesce(sum(dr.qty_31),    0),
    'qty_36',    coalesce(al.opening_dispatched_36,    0) + coalesce(sum(dr.qty_36),    0),
    'qty_40',    coalesce(al.opening_dispatched_40,    0) + coalesce(sum(dr.qty_40),    0),
    'qty_45',    coalesce(al.opening_dispatched_45,    0) + coalesce(sum(dr.qty_45),    0),
    'qty_meter', coalesce(al.opening_dispatched_meter, 0) + coalesce(sum(dr.qty_meter), 0)
  )
  from authority_letters al
  left join dispatch_records dr
    on dr.authority_letter_id = al.id
   and (p_exclude_record_id is null or dr.id <> p_exclude_record_id)
  where al.id = p_letter_id
  group by al.id;
$$;

-- ── 3. Auto-close a PO when fully dispatched ────────────────────────────────
-- Mirrors the auto-close block in dispatch-records POST: PO must be Active
-- and not the system-unallocated bucket; every size with ordered qty > 0 must
-- have total dispatched (letter openings + dispatch records, all letters)
-- >= ordered. Returns true if it closed the PO.
-- NOTE (bug fix vs the JS): the JS never selected ordered_40, so a PO with a
-- 40ft requirement could auto-close with nothing dispatched in 40ft. The RPC
-- includes ordered_40 — strictly safer (never closes earlier than the JS did).
create or replace function public.close_po_if_fully_dispatched(p_po_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po record;
  v_d  record;
begin
  select id, status, is_system_unallocated,
         coalesce(ordered_31, 0)    as o31,
         coalesce(ordered_36, 0)    as o36,
         coalesce(ordered_40, 0)    as o40,
         coalesce(ordered_45, 0)    as o45,
         coalesce(ordered_meter, 0) as om
    into v_po
    from purchase_orders
   where id = p_po_id;

  if v_po.id is null or v_po.is_system_unallocated or v_po.status <> 'Active' then
    return false;
  end if;

  select coalesce(sum(t.d31), 0) as d31,
         coalesce(sum(t.d36), 0) as d36,
         coalesce(sum(t.d40), 0) as d40,
         coalesce(sum(t.d45), 0) as d45,
         coalesce(sum(t.dm),  0) as dm
    into v_d
    from (
      select coalesce(al.opening_dispatched_31,    0) + coalesce(sum(dr.qty_31),    0) as d31,
             coalesce(al.opening_dispatched_36,    0) + coalesce(sum(dr.qty_36),    0) as d36,
             coalesce(al.opening_dispatched_40,    0) + coalesce(sum(dr.qty_40),    0) as d40,
             coalesce(al.opening_dispatched_45,    0) + coalesce(sum(dr.qty_45),    0) as d45,
             coalesce(al.opening_dispatched_meter, 0) + coalesce(sum(dr.qty_meter), 0) as dm
        from authority_letters al
        left join dispatch_records dr on dr.authority_letter_id = al.id
       where al.po_id = p_po_id
       group by al.id
    ) t;

  if (v_po.o31 <= 0 or v_d.d31 >= v_po.o31)
     and (v_po.o36 <= 0 or v_d.d36 >= v_po.o36)
     and (v_po.o40 <= 0 or v_d.d40 >= v_po.o40)
     and (v_po.o45 <= 0 or v_d.d45 >= v_po.o45)
     and (v_po.om  <= 0 or v_d.dm  >= v_po.om) then
    update purchase_orders
       set status = 'Closed', updated_at = now()
     where id = p_po_id;
    return true;
  end if;

  return false;
end;
$$;

-- ── 4. Total allocated to a production entry (cap validation) ───────────────
-- Mirrors the otherTotal reduce() in production-allocations PATCH.
create or replace function public.get_entry_allocation_totals(
  p_entry_id uuid,
  p_exclude_alloc_id uuid default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'qty_31',    coalesce(sum(qty_31),    0),
    'qty_36',    coalesce(sum(qty_36),    0),
    'qty_45',    coalesce(sum(qty_45),    0),
    'qty_meter', coalesce(sum(qty_meter), 0)
  )
  from production_allocations
  where production_entry_id = p_entry_id
    and (p_exclude_alloc_id is null or id <> p_exclude_alloc_id);
$$;

-- ── 5. Total produced against a PO (opening + allocations) ──────────────────
-- Mirrors the alreadyProduced reduce() in production-allocations POST (exclude
-- by entry) and PATCH (exclude by allocation id). Null if the PO is missing.
create or replace function public.get_po_produced_totals(
  p_po_id uuid,
  p_exclude_entry_id uuid default null,
  p_exclude_alloc_id uuid default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'qty_31',    coalesce(po.opening_produced_31,    0) + coalesce(sum(pa.qty_31),    0),
    'qty_36',    coalesce(po.opening_produced_36,    0) + coalesce(sum(pa.qty_36),    0),
    'qty_45',    coalesce(po.opening_produced_45,    0) + coalesce(sum(pa.qty_45),    0),
    'qty_meter', coalesce(po.opening_produced_meter, 0) + coalesce(sum(pa.qty_meter), 0)
  )
  from purchase_orders po
  left join production_allocations pa
    on pa.po_id = po.id
   and (p_exclude_entry_id is null or pa.production_entry_id <> p_exclude_entry_id)
   and (p_exclude_alloc_id is null or pa.id <> p_exclude_alloc_id)
  where po.id = p_po_id
  group by po.id;
$$;

-- ── 6. All letters for a plant with remaining balances (dispatch dropdown) ──
-- Mirrors the listAll flow in authority-letters GET: letters joined to their
-- PO (inner, filtered by plant) + contractor, per-letter dispatched totals,
-- remaining = greatest(0, qty - opening - dispatched). qty_40/remaining_40
-- are literal 0 to match the existing API response shape (no letter has 40ft
-- authorised today; the letter-entry form doesn't offer 40ft).
create or replace function public.get_plant_authority_letters(p_plant_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',              al.id,
      'letter_number',   al.letter_number,
      'expiry_date',     al.expiry_date,
      'issued_by',       coalesce(al.issued_by, ''),
      'po_id',           al.po_id,
      'contractor_id',   al.contractor_id,
      'po_number',       coalesce(po.po_number, ''),
      'customer_name',   coalesce(po.customer_name, ''),
      'contractor_name', coalesce(c.name, ''),
      'qty_31',          coalesce(al.qty_31,    0),
      'qty_36',          coalesce(al.qty_36,    0),
      'qty_40',          0,
      'qty_45',          coalesce(al.qty_45,    0),
      'qty_meter',       coalesce(al.qty_meter, 0),
      'remaining_31',    greatest(0, coalesce(al.qty_31,    0) - coalesce(al.opening_dispatched_31,    0) - coalesce(d.s31, 0)),
      'remaining_36',    greatest(0, coalesce(al.qty_36,    0) - coalesce(al.opening_dispatched_36,    0) - coalesce(d.s36, 0)),
      'remaining_40',    0,
      'remaining_45',    greatest(0, coalesce(al.qty_45,    0) - coalesce(al.opening_dispatched_45,    0) - coalesce(d.s45, 0)),
      'remaining_meter', greatest(0, coalesce(al.qty_meter, 0) - coalesce(al.opening_dispatched_meter, 0) - coalesce(d.sm,  0)),
      'closed_at',       al.closed_at
    )
    order by al.created_at desc
  ), '[]'::jsonb)
  from authority_letters al
  join purchase_orders po on po.id = al.po_id and po.plant_id = p_plant_id
  left join contractors c on c.id = al.contractor_id
  left join lateral (
    select sum(dr.qty_31)    as s31,
           sum(dr.qty_36)    as s36,
           sum(dr.qty_45)    as s45,
           sum(dr.qty_meter) as sm
      from dispatch_records dr
     where dr.authority_letter_id = al.id
  ) d on true;
$$;

-- ── 7. Look up one letter by number with remaining balances ─────────────────
-- Mirrors the letterNumber flow in authority-letters GET (plant-member
-- dispatch). Case-insensitive exact match on the trimmed number. When
-- p_plant_id is given but the letter's PO is at a different plant, the letter
-- is still returned with blank po_number/customer_name — identical to the
-- old PostgREST behaviour (embedded filter without !inner nulls the embed,
-- it doesn't drop the row). Returns null when no letter matches.
create or replace function public.get_authority_letter_lookup(
  p_letter_number text,
  p_plant_id uuid default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id',              al.id,
    'letter_number',   al.letter_number,
    'expiry_date',     al.expiry_date,
    'po_id',           al.po_id,
    'contractor_id',   al.contractor_id,
    'po_number',       coalesce(po.po_number, ''),
    'customer_name',   coalesce(po.customer_name, ''),
    'contractor_name', coalesce(c.name, ''),
    'qty_31',          coalesce(al.qty_31,    0),
    'qty_36',          coalesce(al.qty_36,    0),
    'qty_45',          coalesce(al.qty_45,    0),
    'qty_meter',       coalesce(al.qty_meter, 0),
    'remaining_31',    greatest(0, coalesce(al.qty_31,    0) - coalesce(al.opening_dispatched_31,    0) - coalesce(d.s31, 0)),
    'remaining_36',    greatest(0, coalesce(al.qty_36,    0) - coalesce(al.opening_dispatched_36,    0) - coalesce(d.s36, 0)),
    'remaining_45',    greatest(0, coalesce(al.qty_45,    0) - coalesce(al.opening_dispatched_45,    0) - coalesce(d.s45, 0)),
    'remaining_meter', greatest(0, coalesce(al.qty_meter, 0) - coalesce(al.opening_dispatched_meter, 0) - coalesce(d.sm,  0))
  )
  from authority_letters al
  left join purchase_orders po
    on po.id = al.po_id
   and (p_plant_id is null or po.plant_id = p_plant_id)
  left join contractors c on c.id = al.contractor_id
  left join lateral (
    select sum(dr.qty_31)    as s31,
           sum(dr.qty_36)    as s36,
           sum(dr.qty_45)    as s45,
           sum(dr.qty_meter) as sm
      from dispatch_records dr
     where dr.authority_letter_id = al.id
  ) d on true
  where al.letter_number ilike trim(p_letter_number)
  order by al.created_at desc
  limit 1;
$$;
