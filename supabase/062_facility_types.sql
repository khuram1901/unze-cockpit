-- Migration 062: Richer facility types + bank grouping + executive synopsis RPC
-- Apply manually via Supabase SQL Editor AFTER 061.

-- ── 1. Add facility_name column (the sub-facility label within a bank) ─────────
-- E.g. bank_name = "HBL", facility_name = "Guarantee Limit"
--      bank_name = "HBL", facility_name = "Overdraft"
--      bank_name = "Faysal Bank", facility_name = "LC Facility"

alter table guarantee_facilities
  add column if not exists facility_name text;

-- Back-fill: use the existing facility_type as the name for any existing rows
update guarantee_facilities
  set facility_name = facility_type
  where facility_name is null;

-- ── 2. Rebuild get_guarantee_summary() to include facility_name + bank grouping ─

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

  -- resolve effective bill date: linked receivable wins, manual fallback
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

  -- per-facility utilisation
  fac_util as (
    select
      f.id, f.bank_name, f.facility_name, f.facility_type,
      f.total_limit, f.notes, f.active,
      coalesce(sum(g.amount) filter (where g.status = 'Active'), 0) as seized
    from guarantee_facilities f
    left join guarantees g on g.facility_id = f.id
    group by f.id
  ),

  -- per-bank rollup (for the grouped display)
  bank_rollup as (
    select
      bank_name,
      sum(total_limit)                       as bank_total_limit,
      sum(seized)                            as bank_seized,
      greatest(0, sum(total_limit) - sum(seized)) as bank_available,
      case when sum(total_limit) > 0
           then round(sum(seized) * 100 / sum(total_limit))
           else 0
      end                                    as bank_utilisation_pct,
      jsonb_agg(jsonb_build_object(
        'id',               id,
        'facility_name',    facility_name,
        'facility_type',    facility_type,
        'total_limit',      total_limit,
        'seized',           seized,
        'available',        greatest(0, total_limit - seized),
        'utilisation_pct',  case when total_limit > 0
                                 then round(seized * 100 / total_limit)
                                 else 0 end,
        'notes',            notes,
        'active',           active
      ) order by facility_name) as sub_facilities
    from fac_util
    where active = true
    group by bank_name
    order by bank_name
  )

  select jsonb_build_object(

    'facilities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',               fu.id,
        'bank_name',        fu.bank_name,
        'facility_name',    fu.facility_name,
        'facility_type',    fu.facility_type,
        'total_limit',      fu.total_limit,
        'seized',           fu.seized,
        'available',        greatest(0, fu.total_limit - fu.seized),
        'utilisation_pct',  case when fu.total_limit > 0
                                 then round(fu.seized * 100 / fu.total_limit)
                                 else 0 end,
        'notes',            fu.notes,
        'active',           fu.active
      ) order by fu.bank_name, fu.facility_name)
      from fac_util fu where fu.active = true
    ), '[]'::jsonb),

    'banks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bank_name',          br.bank_name,
        'bank_total_limit',   br.bank_total_limit,
        'bank_seized',        br.bank_seized,
        'bank_available',     br.bank_available,
        'bank_utilisation_pct', br.bank_utilisation_pct,
        'sub_facilities',     br.sub_facilities
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
        'active_count',              count(*)          filter (where g.status = 'Active'),
        'total_amount_active',       coalesce(sum(g.amount)              filter (where g.status = 'Active'), 0),
        'total_cash_margin_stuck',   coalesce(sum(g.cash_margin_amount)  filter (where g.status = 'Active'), 0),
        'total_bank_charges',        coalesce(sum(g.bank_charges), 0),
        'overdue_count',             count(*)          filter (where g.chase_urgency = 'Overdue'),
        'due_soon_count',            count(*)          filter (where g.chase_urgency = 'Due soon')
      )
      from g
    )

  ) into v_result;

  return v_result;
end;
$$;

grant execute on function get_guarantee_summary() to authenticated;


-- ── 3. New RPC: get_facility_synopsis() — for the executive dashboard ──────────
-- Returns a compact bank-by-bank summary for the CEO strip.

create or replace function get_facility_synopsis()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'bank_name',            br.bank_name,
      'bank_total_limit',     br.bank_total_limit,
      'bank_seized',          br.bank_seized,
      'bank_available',       br.bank_available,
      'bank_utilisation_pct', br.bank_utilisation_pct,
      'active_guarantees',    br.active_guarantees,
      'overdue_count',        br.overdue_count
    ) order by br.bank_name)
    from (
      select
        f.bank_name,
        sum(f.total_limit)                                                as bank_total_limit,
        coalesce(sum(g_active.amt), 0)                                    as bank_seized,
        greatest(0, sum(f.total_limit) - coalesce(sum(g_active.amt), 0)) as bank_available,
        case when sum(f.total_limit) > 0
             then round(coalesce(sum(g_active.amt), 0) * 100 / sum(f.total_limit))
             else 0
        end                                                               as bank_utilisation_pct,
        coalesce(sum(g_active.cnt), 0)                                    as active_guarantees,
        coalesce(sum(g_overdue.oc), 0)                                    as overdue_count
      from guarantee_facilities f
      left join lateral (
        select sum(amount) as amt, count(*) as cnt
        from guarantees
        where facility_id = f.id and status = 'Active'
      ) g_active on true
      left join lateral (
        select count(*) as oc
        from guarantees
        where facility_id = f.id and status = 'Active'
          and expiry_date is not null and expiry_date < current_date
      ) g_overdue on true
      where f.active = true
      group by f.bank_name
    ) br
  ), '[]'::jsonb);
end;
$$;

grant execute on function get_facility_synopsis() to authenticated;
