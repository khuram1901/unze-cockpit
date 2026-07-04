-- RPC: get_stock_summary(p_plant_id uuid)
-- Returns one row per PO with all produced/dispatched/in-stock totals,
-- delivery forecast, and a JSON array of contractors → letters.
-- Replaces the 5-query JS aggregation in /api/stock/summary.
-- Apply manually via Supabase SQL Editor.

create or replace function get_stock_summary(p_plant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff date := current_date - 14;
  v_result jsonb;
begin

  with

  -- ── opening allocations per PO ────────────────────────────────────────────
  opening as (
    select
      oa.po_id,
      coalesce(oa.qty_31,    0) as qty_31,
      coalesce(oa.qty_36,    0) as qty_36,
      coalesce(oa.qty_40,    0) as qty_40,
      coalesce(oa.qty_45,    0) as qty_45,
      coalesce(oa.qty_meter, 0) as qty_meter
    from opening_stock_allocations oa
    join purchase_orders po on po.id = oa.po_id
    where po.plant_id = p_plant_id
  ),

  -- ── live production totals per PO ────────────────────────────────────────
  prod as (
    select
      pa.po_id,
      coalesce(sum(pa.qty_31),    0) as qty_31,
      coalesce(sum(pa.qty_36),    0) as qty_36,
      coalesce(sum(pa.qty_40),    0) as qty_40,
      coalesce(sum(pa.qty_45),    0) as qty_45,
      coalesce(sum(pa.qty_meter), 0) as qty_meter
    from production_allocations pa
    join purchase_orders po on po.id = pa.po_id
    where po.plant_id = p_plant_id
    group by pa.po_id
  ),

  -- ── 14-day avg daily production rate per PO (for delivery forecast) ──────
  recent_prod as (
    select
      pa.po_id,
      coalesce(sum(pa.qty_31 + pa.qty_36 + pa.qty_40 + pa.qty_45 + pa.qty_meter), 0)::numeric / 14 as avg_daily_rate
    from production_allocations pa
    join production_entries pe on pe.id = pa.production_entry_id
    join purchase_orders po on po.id = pa.po_id
    where po.plant_id = p_plant_id
      and pe.entry_date >= v_cutoff
    group by pa.po_id
  ),

  -- ── dispatch totals per authority letter ─────────────────────────────────
  letter_dispatch as (
    select
      al.id                                                                                  as letter_id,
      al.po_id,
      al.contractor_id,
      al.letter_number,
      al.issue_date,
      al.expiry_date,
      al.issued_by,
      al.notes,
      coalesce(al.qty_31,    0)                                                              as qty_31,
      coalesce(al.qty_36,    0)                                                              as qty_36,
      coalesce(al.qty_40,    0)                                                              as qty_40,
      coalesce(al.qty_45,    0)                                                              as qty_45,
      coalesce(al.qty_meter, 0)                                                              as qty_meter,
      coalesce(al.opening_dispatched_31,    0) + coalesce(sum(dr.qty_31),    0)             as dispatched_31,
      coalesce(al.opening_dispatched_36,    0) + coalesce(sum(dr.qty_36),    0)             as dispatched_36,
      coalesce(al.opening_dispatched_40,    0) + coalesce(sum(dr.qty_40),    0)             as dispatched_40,
      coalesce(al.opening_dispatched_45,    0) + coalesce(sum(dr.qty_45),    0)             as dispatched_45,
      coalesce(al.opening_dispatched_meter, 0) + coalesce(sum(dr.qty_meter), 0)             as dispatched_meter,
      c.name                                                                                 as contractor_name,
      c.contact_phone                                                                        as contractor_phone
    from authority_letters al
    join purchase_orders po  on po.id  = al.po_id
    join contractors      c  on c.id   = al.contractor_id
    left join dispatch_records dr on dr.authority_letter_id = al.id
    where po.plant_id = p_plant_id
    group by al.id, c.name, c.contact_phone
  ),

  -- ── letter summaries (remaining = qty - dispatched) ──────────────────────
  letter_summary as (
    select
      ld.*,
      greatest(0, ld.qty_31    - ld.dispatched_31)    as remaining_31,
      greatest(0, ld.qty_36    - ld.dispatched_36)    as remaining_36,
      greatest(0, ld.qty_40    - ld.dispatched_40)    as remaining_40,
      greatest(0, ld.qty_45    - ld.dispatched_45)    as remaining_45,
      greatest(0, ld.qty_meter - ld.dispatched_meter) as remaining_meter
    from letter_dispatch ld
  ),

  -- ── contractor totals per PO ──────────────────────────────────────────────
  contractor_agg as (
    select
      ls.po_id,
      ls.contractor_id,
      ls.contractor_name,
      ls.contractor_phone,
      coalesce(sum(ls.qty_31),          0) as total_authorized_31,
      coalesce(sum(ls.qty_36),          0) as total_authorized_36,
      coalesce(sum(ls.qty_40),          0) as total_authorized_40,
      coalesce(sum(ls.qty_45),          0) as total_authorized_45,
      coalesce(sum(ls.qty_meter),       0) as total_authorized_meter,
      coalesce(sum(ls.dispatched_31),   0) as total_dispatched_31,
      coalesce(sum(ls.dispatched_36),   0) as total_dispatched_36,
      coalesce(sum(ls.dispatched_40),   0) as total_dispatched_40,
      coalesce(sum(ls.dispatched_45),   0) as total_dispatched_45,
      coalesce(sum(ls.dispatched_meter),0) as total_dispatched_meter,
      coalesce(sum(ls.remaining_31),    0) as total_remaining_31,
      coalesce(sum(ls.remaining_36),    0) as total_remaining_36,
      coalesce(sum(ls.remaining_40),    0) as total_remaining_40,
      coalesce(sum(ls.remaining_45),    0) as total_remaining_45,
      coalesce(sum(ls.remaining_meter), 0) as total_remaining_meter,
      jsonb_agg(
        jsonb_build_object(
          'id',            ls.letter_id,
          'po_id',         ls.po_id,
          'contractor_id', ls.contractor_id,
          'contractor_name', ls.contractor_name,
          'contractor_phone', ls.contractor_phone,
          'letter_number', ls.letter_number,
          'issue_date',    ls.issue_date,
          'expiry_date',   ls.expiry_date,
          'issued_by',     ls.issued_by,
          'notes',         ls.notes,
          'qty_31',        ls.qty_31,
          'qty_36',        ls.qty_36,
          'qty_40',        ls.qty_40,
          'qty_45',        ls.qty_45,
          'qty_meter',     ls.qty_meter,
          'dispatched_31', ls.dispatched_31,
          'dispatched_36', ls.dispatched_36,
          'dispatched_40', ls.dispatched_40,
          'dispatched_45', ls.dispatched_45,
          'dispatched_meter', ls.dispatched_meter,
          'remaining_31',  ls.remaining_31,
          'remaining_36',  ls.remaining_36,
          'remaining_40',  ls.remaining_40,
          'remaining_45',  ls.remaining_45,
          'remaining_meter', ls.remaining_meter
        )
        order by ls.issue_date desc
      ) as letters
    from letter_summary ls
    group by ls.po_id, ls.contractor_id, ls.contractor_name, ls.contractor_phone
  ),

  -- ── dispatch totals per PO (sum across all letters) ───────────────────────
  po_dispatch as (
    select
      po_id,
      coalesce(sum(total_dispatched_31),    0) as dispatched_31,
      coalesce(sum(total_dispatched_36),    0) as dispatched_36,
      coalesce(sum(total_dispatched_40),    0) as dispatched_40,
      coalesce(sum(total_dispatched_45),    0) as dispatched_45,
      coalesce(sum(total_dispatched_meter), 0) as dispatched_meter,
      jsonb_agg(
        jsonb_build_object(
          'contractor_id',          ca.contractor_id,
          'contractor_name',        ca.contractor_name,
          'contractor_phone',       ca.contractor_phone,
          'total_authorized_31',    ca.total_authorized_31,
          'total_authorized_36',    ca.total_authorized_36,
          'total_authorized_40',    ca.total_authorized_40,
          'total_authorized_45',    ca.total_authorized_45,
          'total_authorized_meter', ca.total_authorized_meter,
          'total_dispatched_31',    ca.total_dispatched_31,
          'total_dispatched_36',    ca.total_dispatched_36,
          'total_dispatched_40',    ca.total_dispatched_40,
          'total_dispatched_45',    ca.total_dispatched_45,
          'total_dispatched_meter', ca.total_dispatched_meter,
          'total_remaining_31',     ca.total_remaining_31,
          'total_remaining_36',     ca.total_remaining_36,
          'total_remaining_40',     ca.total_remaining_40,
          'total_remaining_45',     ca.total_remaining_45,
          'total_remaining_meter',  ca.total_remaining_meter,
          'letters',                ca.letters
        )
      ) as contractors
    from contractor_agg ca
    group by ca.po_id
  ),

  -- ── final PO assembly ─────────────────────────────────────────────────────
  po_summary as (
    select
      po.id,
      po.plant_id,
      po.plant_name,
      po.customer_name,
      po.po_number,
      po.po_label,
      po.status,
      po.is_system_unallocated,
      po.start_date,
      po.notes,
      po.variance_pct,
      coalesce(po.ordered_31,    0) as ordered_31,
      coalesce(po.ordered_36,    0) as ordered_36,
      coalesce(po.ordered_40,    0) as ordered_40,
      coalesce(po.ordered_45,    0) as ordered_45,
      coalesce(po.ordered_meter, 0) as ordered_meter,

      -- produced = live production + opening (allocation takes precedence over legacy fields)
      coalesce(p.qty_31,    0) + case when (coalesce(o.qty_31,0)+coalesce(o.qty_36,0)+coalesce(o.qty_40,0)+coalesce(o.qty_45,0)+coalesce(o.qty_meter,0)) > 0
                                      then coalesce(o.qty_31,    0) else coalesce(po.opening_produced_31,    0) end as produced_31,
      coalesce(p.qty_36,    0) + case when (coalesce(o.qty_31,0)+coalesce(o.qty_36,0)+coalesce(o.qty_40,0)+coalesce(o.qty_45,0)+coalesce(o.qty_meter,0)) > 0
                                      then coalesce(o.qty_36,    0) else coalesce(po.opening_produced_36,    0) end as produced_36,
      coalesce(p.qty_40,    0) + case when (coalesce(o.qty_31,0)+coalesce(o.qty_36,0)+coalesce(o.qty_40,0)+coalesce(o.qty_45,0)+coalesce(o.qty_meter,0)) > 0
                                      then coalesce(o.qty_40,    0) else coalesce(po.opening_produced_40,    0) end as produced_40,
      coalesce(p.qty_45,    0) + case when (coalesce(o.qty_31,0)+coalesce(o.qty_36,0)+coalesce(o.qty_40,0)+coalesce(o.qty_45,0)+coalesce(o.qty_meter,0)) > 0
                                      then coalesce(o.qty_45,    0) else coalesce(po.opening_produced_45,    0) end as produced_45,
      coalesce(p.qty_meter, 0) + case when (coalesce(o.qty_31,0)+coalesce(o.qty_36,0)+coalesce(o.qty_40,0)+coalesce(o.qty_45,0)+coalesce(o.qty_meter,0)) > 0
                                      then coalesce(o.qty_meter, 0) else coalesce(po.opening_produced_meter, 0) end as produced_meter,

      coalesce(pd.dispatched_31,    0) as dispatched_31,
      coalesce(pd.dispatched_36,    0) as dispatched_36,
      coalesce(pd.dispatched_40,    0) as dispatched_40,
      coalesce(pd.dispatched_45,    0) as dispatched_45,
      coalesce(pd.dispatched_meter, 0) as dispatched_meter,

      coalesce(rp.avg_daily_rate, 0)   as avg_daily_rate,
      coalesce(pd.contractors, '[]'::jsonb) as contractors
    from purchase_orders po
    left join opening      o  on o.po_id  = po.id
    left join prod         p  on p.po_id  = po.id
    left join recent_prod  rp on rp.po_id = po.id
    left join po_dispatch  pd on pd.po_id = po.id
    where po.plant_id = p_plant_id
  )

  select jsonb_agg(
    jsonb_build_object(
      'po', jsonb_build_object(
        'id',                   ps.id,
        'plant_id',             ps.plant_id,
        'plant_name',           ps.plant_name,
        'customer_name',        ps.customer_name,
        'po_number',            ps.po_number,
        'po_label',             ps.po_label,
        'ordered_31',           ps.ordered_31,
        'ordered_36',           ps.ordered_36,
        'ordered_40',           ps.ordered_40,
        'ordered_45',           ps.ordered_45,
        'ordered_meter',        ps.ordered_meter,
        'variance_pct',         ps.variance_pct,
        'status',               ps.status,
        'is_system_unallocated',ps.is_system_unallocated,
        'start_date',           ps.start_date,
        'notes',                ps.notes,
        'produced_31',          ps.produced_31,
        'produced_36',          ps.produced_36,
        'produced_40',          ps.produced_40,
        'produced_45',          ps.produced_45,
        'produced_meter',       ps.produced_meter,
        'dispatched_31',        ps.dispatched_31,
        'dispatched_36',        ps.dispatched_36,
        'dispatched_40',        ps.dispatched_40,
        'dispatched_45',        ps.dispatched_45,
        'dispatched_meter',     ps.dispatched_meter,
        'in_stock_31',          greatest(0, ps.produced_31    - ps.dispatched_31),
        'in_stock_36',          greatest(0, ps.produced_36    - ps.dispatched_36),
        'in_stock_40',          greatest(0, ps.produced_40    - ps.dispatched_40),
        'in_stock_45',          greatest(0, ps.produced_45    - ps.dispatched_45),
        'in_stock_meter',       greatest(0, ps.produced_meter - ps.dispatched_meter),
        'fulfillment_pct',
          case when (ps.ordered_31 + ps.ordered_36 + ps.ordered_40 + ps.ordered_45 + ps.ordered_meter) > 0
               then round(
                 (ps.produced_31 + ps.produced_36 + ps.produced_40 + ps.produced_45 + ps.produced_meter)::numeric * 100
                 / (ps.ordered_31 + ps.ordered_36 + ps.ordered_40 + ps.ordered_45 + ps.ordered_meter)
               )
               else null
          end,
        'daily_rate',           round(ps.avg_daily_rate),
        'estimated_completion_date',
          case
            when ps.status = 'Active'
              and not ps.is_system_unallocated
              and ps.avg_daily_rate > 0
              and (ps.ordered_31 + ps.ordered_36 + ps.ordered_40 + ps.ordered_45 + ps.ordered_meter)
                > (ps.produced_31 + ps.produced_36 + ps.produced_40 + ps.produced_45 + ps.produced_meter)
            then (current_date + ceil(
                   ((ps.ordered_31 + ps.ordered_36 + ps.ordered_40 + ps.ordered_45 + ps.ordered_meter)
                    - (ps.produced_31 + ps.produced_36 + ps.produced_40 + ps.produced_45 + ps.produced_meter))::numeric
                   / ps.avg_daily_rate
                 )::int)::text
            else null
          end
      ),
      'contractors', ps.contractors
    )
    order by ps.is_system_unallocated asc, ps.status asc, ps.customer_name asc
  )
  into v_result
  from po_summary ps;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

-- Grant execute to authenticated users (route uses service role, but belt-and-braces)
grant execute on function get_stock_summary(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: get_contractor_performance(p_plant_id uuid)
-- Returns per-contractor metrics for the Contractor Performance section.
-- Replaces the 2-query JS aggregation in /api/stock/contractor-performance.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function get_contractor_performance(p_plant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  with

  letter_totals as (
    select
      al.contractor_id,
      c.name                                                         as contractor_name,
      c.contact_phone,
      al.id                                                          as letter_id,
      al.issue_date,
      -- total authorised on this letter (all sizes)
      coalesce(al.qty_31,0) + coalesce(al.qty_36,0) + coalesce(al.qty_40,0)
        + coalesce(al.qty_45,0) + coalesce(al.qty_meter,0)          as authorised,
      -- total collected: opening balance + live records
      coalesce(al.opening_dispatched_31,0)    + coalesce(al.opening_dispatched_36,0)
        + coalesce(al.opening_dispatched_40,0) + coalesce(al.opening_dispatched_45,0)
        + coalesce(al.opening_dispatched_meter,0)
        + coalesce(dr_sum.total, 0)                                  as collected,
      -- last live dispatch date (null if no live records)
      dr_sum.last_date
    from authority_letters al
    join purchase_orders po on po.id = al.po_id and po.plant_id = p_plant_id
    join contractors c      on c.id  = al.contractor_id
    left join lateral (
      select
        sum(qty_31 + qty_36 + qty_40 + qty_45 + qty_meter) as total,
        max(dispatch_date)                                  as last_date
      from dispatch_records
      where authority_letter_id = al.id
    ) dr_sum on true
  ),

  letter_classified as (
    select
      lt.*,
      greatest(0, lt.authorised - lt.collected) as remaining,
      case
        when lt.authorised > 0 and greatest(0, lt.authorised - lt.collected) = 0 then 'full'
        when lt.collected  > 0                                                    then 'partial'
        else 'none'
      end as status,
      -- days from issue to last dispatch (only for fully-collected letters with live records)
      case
        when lt.authorised > 0
          and greatest(0, lt.authorised - lt.collected) = 0
          and lt.last_date is not null
        then (lt.last_date - lt.issue_date)
        else null
      end as days_to_collect
    from letter_totals lt
  ),

  contractor_agg as (
    select
      contractor_id,
      contractor_name,
      contact_phone,
      count(*)                                               as letters_issued,
      coalesce(sum(authorised),  0)                         as total_authorised,
      coalesce(sum(collected),   0)                         as total_collected,
      count(*) filter (where status = 'full')               as letters_fully_collected,
      count(*) filter (where status = 'partial')            as letters_partial,
      count(*) filter (where status = 'none')               as letters_not_started,
      round(avg(days_to_collect))                           as avg_days_to_full_collection,
      min(days_to_collect)                                  as fastest_days,
      max(days_to_collect)                                  as slowest_days
    from letter_classified
    group by contractor_id, contractor_name, contact_phone
  )

  select jsonb_agg(
    jsonb_build_object(
      'contractor_id',               ca.contractor_id,
      'contractor_name',             ca.contractor_name,
      'contractor_phone',            ca.contact_phone,
      'letters_issued',              ca.letters_issued,
      'total_authorised',            ca.total_authorised,
      'total_collected',             ca.total_collected,
      'collection_pct',              case when ca.total_authorised > 0
                                         then round(ca.total_collected::numeric * 100 / ca.total_authorised)
                                         else 0 end,
      'letters_fully_collected',     ca.letters_fully_collected,
      'letters_partial',             ca.letters_partial,
      'letters_not_started',         ca.letters_not_started,
      'avg_days_to_full_collection', ca.avg_days_to_full_collection,
      'fastest_days',                ca.fastest_days,
      'slowest_days',                ca.slowest_days
    )
    order by ca.total_collected desc
  )
  into v_result
  from contractor_agg ca;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

grant execute on function get_contractor_performance(uuid) to authenticated;
