-- Khuram: the Stock page's "Authority Letter Expiry Alerts" banner is
-- "really messy" — 55 expired letters across all plants, 24 of them from
-- before 2026, dumped in one unsorted list with no way to dismiss one once
-- it's dealt with. Root cause: authority_letters has no concept of
-- "closed" — a letter with 1-7 poles left uncollected out of hundreds
-- authorised (clearly dead paperwork, nobody's ever coming back for it
-- years later) warns forever, exactly like a letter with a genuinely
-- large balance still outstanding.
--
-- This adds the "Close letter" action Khuram approved (mirrors how PO's
-- already have a Close action — stays visible, just stops nagging).

alter table public.authority_letters
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by text;

-- get_stock_summary needs closed_at/closed_by threaded through so the
-- client can exclude closed letters from the warning banner while still
-- showing them (greyed out) in the drill-down tree — closing a letter
-- hides the nag, it doesn't erase the record.
create or replace function public.get_stock_summary(p_plant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cutoff date := current_date - 14;
  v_result jsonb;
begin

  with

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
      al.closed_at,
      al.closed_by,
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
          'closed_at',     ls.closed_at,
          'closed_by',     ls.closed_by,
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
$function$;
