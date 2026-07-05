-- Migration 061: Link guarantees to receivables (first bill date)
-- Apply manually via Supabase SQL Editor AFTER 060.

-- ── 1. Add FK column ──────────────────────────────────────────────────────────
alter table guarantees
  add column if not exists first_bill_receivable_id uuid references receivables(id) on delete set null;

-- ── 2. Rebuild get_guarantee_summary() to use linked bill date ────────────────
-- When first_bill_receivable_id is set, performance_bill_date comes from
-- receivables.date_submitted (source of truth).
-- Manual performance_bill_date is the fallback for historical guarantees
-- whose bills are not in the system.

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

  -- resolve the effective bill date: linked receivable wins, manual fallback
  g as (
    select
      g.*,
      coalesce(r.date_submitted, g.performance_bill_date)            as effective_bill_date,
      r.date_submitted                                               as linked_bill_date,
      r.invoice_ref                                                  as linked_invoice_ref,
      r.amount                                                       as linked_bill_amount,
      round(g.amount * g.cash_margin_pct / 100)                     as cash_margin_amount,
      -- release due date uses effective bill date
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
      -- chase urgency
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

  fac_util as (
    select
      f.id, f.bank_name, f.facility_type, f.total_limit, f.notes, f.active,
      coalesce(sum(g.amount) filter (where g.status = 'Active'), 0) as seized,
      coalesce(sum(g.amount) filter (where g.status = 'Active'), 0) as utilised
    from guarantee_facilities f
    left join guarantees g on g.facility_id = f.id
    group by f.id
  )

  select jsonb_build_object(

    'facilities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',               fu.id,
        'bank_name',        fu.bank_name,
        'facility_type',    fu.facility_type,
        'total_limit',      fu.total_limit,
        'seized',           fu.seized,
        'available',        greatest(0, fu.total_limit - fu.utilised),
        'utilisation_pct',  case when fu.total_limit > 0
                                 then round(fu.utilised * 100 / fu.total_limit)
                                 else 0 end,
        'notes',            fu.notes,
        'active',           fu.active
      ) order by fu.bank_name)
      from fac_util fu where fu.active = true
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


-- ── 3. RPC: search receivables for linking ────────────────────────────────────
-- Returns bills matching a customer name / invoice ref for the bill-picker dropdown.

create or replace function search_receivables_for_guarantee(
  p_search text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',             r.id,
      'utility',        r.utility,
      'invoice_ref',    r.invoice_ref,
      'amount',         r.amount,
      'date_submitted', r.date_submitted,
      'bill_type',      r.bill_type,
      'status',         r.status
    ) order by r.date_submitted desc)
    from receivables r
    where (
      p_search = ''
      or r.utility ilike '%' || p_search || '%'
      or r.invoice_ref ilike '%' || p_search || '%'
    )
    limit 50
  ), '[]'::jsonb);
end;
$$;

grant execute on function search_receivables_for_guarantee(text) to authenticated;
