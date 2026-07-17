-- Migration 064: Facility capacity check helper + guarantee type breakdown in summary
-- Apply manually via Supabase SQL Editor AFTER 063.

-- ── 1. Helper: how much of a facility is currently seized (Active guarantees only) ──
-- Returns the sum of Active guarantee amounts for a facility, optionally excluding one guarantee (for edits).
create or replace function get_facility_used(
  p_facility_id uuid,
  p_exclude_guarantee_id uuid default null
)
returns numeric
language sql
security definer
set search_path = public
as $$
  select coalesce(
    sum(amount) filter (
      where status = 'Active'
        and (p_exclude_guarantee_id is null or id != p_exclude_guarantee_id)
    ), 0
  )
  from guarantees
  where facility_id = p_facility_id;
$$;

grant execute on function get_facility_used(uuid, uuid) to authenticated;


-- ── 2. Rebuild get_guarantee_summary() to include per-type breakdown per sub-facility ──
-- Adds a `type_breakdown` array to each sub_facility entry, so the UI can show
-- how much of each facility is consumed by each guarantee type.

create or replace function get_guarantee_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  with
  g as (
    select
      g.*,
      coalesce(r.date_submitted, g.performance_bill_date)            as effective_bill_date,
      r.date_submitted                                               as linked_bill_date,
      r.invoice_ref                                                  as linked_invoice_ref,
      r.amount                                                       as linked_bill_amount,
      round(g.amount * g.cash_margin_pct / 100)                     as cash_margin_amount,
      case
        when g.guarantee_type = 'Performance Guarantee'
          and coalesce(r.date_submitted, g.performance_bill_date) is not null
        then (coalesce(r.date_submitted, g.performance_bill_date) + interval '365 days')::date
        else null
      end                                                            as release_due_date,
      case when g.expiry_date is not null
           then (g.expiry_date - current_date)
           else null
      end                                                            as days_to_expiry,
      case
        when g.status not in ('Active', 'Converted') then 'none'
        when g.expiry_date is not null and g.expiry_date < current_date then 'Overdue'
        when g.expiry_date is not null and g.expiry_date <= current_date + 30 then 'Due soon'
        when g.guarantee_type = 'Performance Guarantee'
          and coalesce(r.date_submitted, g.performance_bill_date) is not null
          and (coalesce(r.date_submitted, g.performance_bill_date) + interval '365 days')::date < current_date
          then 'Overdue'
        when g.guarantee_type = 'Performance Guarantee'
          and coalesce(r.date_submitted, g.performance_bill_date) is not null
          and (coalesce(r.date_submitted, g.performance_bill_date) + interval '365 days')::date <= current_date + 30
          then 'Due soon'
        else 'OK'
      end                                                            as chase_urgency
    from guarantees g
    left join receivables r on r.id = g.first_bill_receivable_id
  ),
  -- Per-facility, per-type aggregation (Active only)
  fac_type_breakdown as (
    select
      facility_id,
      guarantee_type,
      count(*)    as type_count,
      sum(amount) as type_seized
    from guarantees
    where status = 'Active' and facility_id is not null
    group by facility_id, guarantee_type
  ),
  fac_util as (
    select
      f.id, f.bank_name, f.facility_name, f.facility_type,
      f.total_limit, f.notes, f.active,
      coalesce(sum(g.amount) filter (where g.status = 'Active'), 0) as seized,
      -- Per-type breakdown as a jsonb array
      coalesce(
        (select jsonb_agg(jsonb_build_object(
          'guarantee_type', ftb.guarantee_type,
          'count',          ftb.type_count,
          'seized',         ftb.type_seized
        ) order by ftb.type_seized desc)
        from fac_type_breakdown ftb where ftb.facility_id = f.id),
        '[]'::jsonb
      ) as type_breakdown
    from guarantee_facilities f
    left join guarantees g on g.facility_id = f.id
    where f.active = true
    group by f.id
  ),
  bank_rollup as (
    select
      bank_name,
      sum(total_limit)                                           as bank_total_limit,
      sum(seized)                                                as bank_seized,
      greatest(0, sum(total_limit) - sum(seized))               as bank_available,
      case when sum(total_limit) > 0
           then round(sum(seized) * 100 / sum(total_limit))
           else 0
      end                                                        as bank_utilisation_pct,
      jsonb_agg(jsonb_build_object(
        'id',              id,
        'facility_name',   facility_name,
        'facility_type',   facility_type,
        'bank_name',       bank_name,
        'total_limit',     total_limit,
        'seized',          seized,
        'available',       greatest(0, total_limit - seized),
        'utilisation_pct', case when total_limit > 0 then round(seized * 100 / total_limit) else 0 end,
        'notes',           notes,
        'active',          active,
        'type_breakdown',  type_breakdown
      ) order by facility_name) as sub_facilities
    from fac_util
    group by bank_name
    order by bank_name
  )
  select jsonb_build_object(
    'facilities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',              fu.id,
        'bank_name',       fu.bank_name,
        'facility_name',   fu.facility_name,
        'facility_type',   fu.facility_type,
        'total_limit',     fu.total_limit,
        'seized',          fu.seized,
        'available',       greatest(0, fu.total_limit - fu.seized),
        'utilisation_pct', case when fu.total_limit > 0 then round(fu.seized * 100 / fu.total_limit) else 0 end,
        'notes',           fu.notes,
        'active',          fu.active,
        'type_breakdown',  fu.type_breakdown
      ) order by fu.bank_name, fu.facility_name)
      from fac_util fu
    ), '[]'::jsonb),
    'banks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bank_name',            br.bank_name,
        'bank_total_limit',     br.bank_total_limit,
        'bank_seized',          br.bank_seized,
        'bank_available',       br.bank_available,
        'bank_utilisation_pct', br.bank_utilisation_pct,
        'sub_facilities',       br.sub_facilities
      ))
      from bank_rollup br
    ), '[]'::jsonb),
    'guarantees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',                       g.id,
        'facility_id',              g.facility_id,
        'guarantee_type',           g.guarantee_type,
        'guarantee_number',         g.guarantee_number,
        'bank_name',                g.bank_name,
        'issue_date',               g.issue_date,
        'expiry_date',              g.expiry_date,
        'amount',                   g.amount,
        'cash_margin_pct',          g.cash_margin_pct,
        'cash_margin_amount',       g.cash_margin_amount,
        'bank_charges',             g.bank_charges,
        'customer_name',            g.customer_name,
        'tender_reference',         g.tender_reference,
        'purpose',                  g.purpose,
        'status',                   g.status,
        'linked_guarantee_id',      g.linked_guarantee_id,
        'first_bill_receivable_id', g.first_bill_receivable_id,
        'linked_bill_date',         g.linked_bill_date,
        'linked_invoice_ref',       g.linked_invoice_ref,
        'linked_bill_amount',       g.linked_bill_amount,
        'performance_bill_date',    g.performance_bill_date,
        'effective_bill_date',      g.effective_bill_date,
        'release_due_date',         g.release_due_date,
        'returned_date',            g.returned_date,
        'days_to_expiry',           g.days_to_expiry,
        'chase_urgency',            g.chase_urgency,
        'notes',                    g.notes,
        'created_by',               g.created_by,
        'created_at',               g.created_at
      ) order by
        case g.chase_urgency when 'Overdue' then 0 when 'Due soon' then 1 else 2 end,
        g.issue_date desc
      )
      from g
    ), '[]'::jsonb),
    'totals', (
      select jsonb_build_object(
        'active_count',            count(*)         filter (where g.status = 'Active'),
        'total_amount_active',     coalesce(sum(g.amount)             filter (where g.status = 'Active'), 0),
        'total_cash_margin_stuck', coalesce(sum(g.cash_margin_amount) filter (where g.status = 'Active'), 0),
        'total_bank_charges',      coalesce(sum(g.bank_charges), 0),
        'overdue_count',           count(*)         filter (where g.chase_urgency = 'Overdue'),
        'due_soon_count',          count(*)         filter (where g.chase_urgency = 'Due soon')
      )
      from g
    )
  ) into v_result;
  return v_result;
end;
$$;

grant execute on function get_guarantee_summary() to authenticated;
