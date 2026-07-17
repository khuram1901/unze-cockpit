-- Migration 060: Guarantee / Pay Order tracking
-- Apply manually via Supabase SQL Editor.

-- ── Guarantee facilities (bank facility pools) ────────────────────────────
create table if not exists guarantee_facilities (
  id           uuid primary key default gen_random_uuid(),
  bank_name    text not null,
  facility_type text not null default 'Guarantee', -- 'Guarantee' | 'Pay Order'
  total_limit  numeric not null default 0,          -- PKR
  notes        text,
  active       boolean not null default true,
  created_at   timestamptz default now()
);

-- ── Guarantees ─────────────────────────────────────────────────────────────
create table if not exists guarantees (
  id                    uuid primary key default gen_random_uuid(),
  facility_id           uuid references guarantee_facilities(id) on delete restrict,

  guarantee_type        text not null,
  -- 'Bid Guarantee' | 'Pay Order' | 'Performance Guarantee' | 'Other'

  guarantee_number      text not null,
  bank_name             text not null,
  issue_date            date not null,
  expiry_date           date,

  amount                numeric not null default 0,        -- face value PKR
  cash_margin_pct       numeric not null default 5,        -- %
  bank_charges          numeric not null default 0,        -- PKR deducted at issuance

  customer_name         text not null,
  tender_reference      text,                              -- tender/contract ref, optional
  purpose               text,                              -- free text description

  status                text not null default 'Active',
  -- 'Active' | 'Converted' | 'Returned' | 'Released' | 'Expired'

  linked_guarantee_id   uuid references guarantees(id) on delete set null,
  -- for Performance Guarantees: points to the Bid Guarantee it replaced

  performance_bill_date date,                              -- date 1st bill submitted (starts 12-month clock)
  returned_date         date,                              -- date physically returned to bank

  notes                 text,
  created_by            text,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

-- ── Indexes ────────────────────────────────────────────────────────────────
create index if not exists idx_guarantees_status       on guarantees(status);
create index if not exists idx_guarantees_facility_id  on guarantees(facility_id);
create index if not exists idx_guarantees_customer     on guarantees(customer_name);
create index if not exists idx_guarantees_expiry       on guarantees(expiry_date);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table guarantee_facilities enable row level security;
alter table guarantees           enable row level security;

-- Service role: full access
create policy "service_role_all_guarantee_facilities" on guarantee_facilities for all to service_role using (true) with check (true);
create policy "service_role_all_guarantees"           on guarantees           for all to service_role using (true) with check (true);

-- Authenticated: read
create policy "auth_read_guarantee_facilities" on guarantee_facilities for select to authenticated using (true);
create policy "auth_read_guarantees"           on guarantees           for select to authenticated using (true);

-- Admin / exec / manager: write
create policy "admin_write_guarantee_facilities" on guarantee_facilities for all to authenticated
  using  (exists (select 1 from members where email = auth.email() and role in ('Admin','Executive','Manager')))
  with check (exists (select 1 from members where email = auth.email() and role in ('Admin','Executive','Manager')));

create policy "admin_write_guarantees" on guarantees for all to authenticated
  using  (exists (select 1 from members where email = auth.email() and role in ('Admin','Executive','Manager')))
  with check (exists (select 1 from members where email = auth.email() and role in ('Admin','Executive','Manager')));


-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: get_guarantee_summary()
-- Returns:
--   facilities  – array of facilities with live utilisation + available
--   guarantees  – array of all guarantees with computed fields
--   totals      – scalar summary (total cash margin stuck, total seized, active count)
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- cash margin and utilisation per guarantee
  g as (
    select
      g.*,
      round(g.amount * g.cash_margin_pct / 100)       as cash_margin_amount,
      -- release due date = performance_bill_date + 365 days
      case when g.guarantee_type = 'Performance Guarantee' and g.performance_bill_date is not null
           then g.performance_bill_date + interval '365 days'
           else null
      end::date                                        as release_due_date,
      -- days until expiry (negative = overdue)
      case when g.expiry_date is not null
           then (g.expiry_date - current_date)
           else null
      end                                              as days_to_expiry,
      -- chase urgency
      case
        when g.status not in ('Active', 'Converted') then 'none'
        when g.expiry_date is not null and g.expiry_date < current_date then 'Overdue'
        when g.expiry_date is not null and g.expiry_date <= current_date + 30 then 'Due soon'
        when g.guarantee_type = 'Performance Guarantee'
          and g.performance_bill_date is not null
          and (g.performance_bill_date + interval '365 days')::date <= current_date + 30 then 'Due soon'
        when g.guarantee_type = 'Performance Guarantee'
          and g.performance_bill_date is not null
          and (g.performance_bill_date + interval '365 days')::date < current_date then 'Overdue'
        else 'OK'
      end                                              as chase_urgency
    from guarantees g
  ),

  -- facility utilisation (only Active guarantees seize the limit)
  fac_util as (
    select
      f.id,
      f.bank_name,
      f.facility_type,
      f.total_limit,
      f.notes,
      f.active,
      coalesce(sum(g.amount) filter (where g.status = 'Active'), 0)  as seized,
      coalesce(sum(g.amount) filter (where g.status = 'Active'), 0)  as utilised
    from guarantee_facilities f
    left join guarantees g on g.facility_id = f.id
    group by f.id
  )

  select jsonb_build_object(

    'facilities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',            fu.id,
        'bank_name',     fu.bank_name,
        'facility_type', fu.facility_type,
        'total_limit',   fu.total_limit,
        'seized',        fu.seized,
        'available',     greatest(0, fu.total_limit - fu.utilised),
        'utilisation_pct', case when fu.total_limit > 0
                                then round(fu.utilised * 100 / fu.total_limit)
                                else 0 end,
        'notes',         fu.notes,
        'active',        fu.active
      ) order by fu.bank_name)
      from fac_util fu
      where fu.active = true
    ), '[]'::jsonb),

    'guarantees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',                   g.id,
        'facility_id',          g.facility_id,
        'guarantee_type',       g.guarantee_type,
        'guarantee_number',     g.guarantee_number,
        'bank_name',            g.bank_name,
        'issue_date',           g.issue_date,
        'expiry_date',          g.expiry_date,
        'amount',               g.amount,
        'cash_margin_pct',      g.cash_margin_pct,
        'cash_margin_amount',   g.cash_margin_amount,
        'bank_charges',         g.bank_charges,
        'customer_name',        g.customer_name,
        'tender_reference',     g.tender_reference,
        'purpose',              g.purpose,
        'status',               g.status,
        'linked_guarantee_id',  g.linked_guarantee_id,
        'performance_bill_date',g.performance_bill_date,
        'release_due_date',     g.release_due_date,
        'returned_date',        g.returned_date,
        'days_to_expiry',       g.days_to_expiry,
        'chase_urgency',        g.chase_urgency,
        'notes',                g.notes,
        'created_by',           g.created_by,
        'created_at',           g.created_at
      ) order by
        -- Overdue first, then Due soon, then Active, then closed
        case g.chase_urgency when 'Overdue' then 0 when 'Due soon' then 1 else 2 end,
        g.issue_date desc
      )
      from g
    ), '[]'::jsonb),

    'totals', (
      select jsonb_build_object(
        'active_count',          count(*)          filter (where g.status = 'Active'),
        'total_amount_active',   coalesce(sum(g.amount)              filter (where g.status = 'Active'), 0),
        'total_cash_margin_stuck', coalesce(sum(g.cash_margin_amount) filter (where g.status = 'Active'), 0),
        'total_bank_charges',    coalesce(sum(g.bank_charges), 0),
        'overdue_count',         count(*)          filter (where g.chase_urgency = 'Overdue'),
        'due_soon_count',        count(*)          filter (where g.chase_urgency = 'Due soon')
      )
      from g
    )

  ) into v_result;

  return v_result;
end;
$$;

grant execute on function get_guarantee_summary() to authenticated;
