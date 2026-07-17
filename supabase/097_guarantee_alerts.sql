-- Migration 097: Overdue/due-soon guarantee alerts for the Executive Dashboard
-- Apply manually via Supabase SQL Editor.
--
-- Khuram: "I noticed that there were certain guarantees that were either
-- expired or they've gone overdue — I don't see that as an alert on my
-- executive dashboard... that needs to be flashing on my executive
-- dashboard."
--
-- get_guarantee_summary() (060_guarantees.sql) already computes chase_urgency
-- correctly (expiry date OR, for Performance Guarantees, the 365-day release
-- clock), but it returns the full facilities + guarantees payload, which is
-- too heavy to fetch just for a dashboard badge. This is a lean, dedicated
-- RPC that returns only the overdue/due-soon items themselves, using the
-- exact same urgency logic, so the executive dashboard and the Bank
-- Facilities page agree on what counts as "overdue".

create or replace function get_guarantee_alerts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  with g as (
    select
      guarantees.*,
      case
        when status not in ('Active', 'Converted') then 'none'
        when expiry_date is not null and expiry_date < current_date then 'Overdue'
        when expiry_date is not null and expiry_date <= current_date + 30 then 'Due soon'
        when guarantee_type = 'Performance Guarantee'
          and performance_bill_date is not null
          and (performance_bill_date + interval '365 days')::date <= current_date + 30 then 'Due soon'
        when guarantee_type = 'Performance Guarantee'
          and performance_bill_date is not null
          and (performance_bill_date + interval '365 days')::date < current_date then 'Overdue'
        else 'OK'
      end as chase_urgency,
      coalesce(
        expiry_date,
        case when guarantee_type = 'Performance Guarantee' and performance_bill_date is not null
             then (performance_bill_date + interval '365 days')::date
             else null
        end
      ) as effective_due_date
    from guarantees
  )
  select jsonb_build_object(
    'overdue_count',  count(*) filter (where chase_urgency = 'Overdue'),
    'due_soon_count', count(*) filter (where chase_urgency = 'Due soon'),
    'overdue', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',                g.id,
        'customer_name',     g.customer_name,
        'guarantee_number',  g.guarantee_number,
        'bank_name',         g.bank_name,
        'guarantee_type',    g.guarantee_type,
        'amount',            g.amount,
        'due_date',          g.effective_due_date,
        'days_overdue',      (current_date - g.effective_due_date)::int
      ) order by g.effective_due_date asc nulls last)
      from g where chase_urgency = 'Overdue'
    ), '[]'::jsonb),
    'due_soon', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',                g.id,
        'customer_name',     g.customer_name,
        'guarantee_number',  g.guarantee_number,
        'bank_name',         g.bank_name,
        'guarantee_type',    g.guarantee_type,
        'amount',            g.amount,
        'due_date',          g.effective_due_date,
        'days_left',         (g.effective_due_date - current_date)::int
      ) order by g.effective_due_date asc nulls last)
      from g where chase_urgency = 'Due soon'
    ), '[]'::jsonb)
  ) into v_result
  from g;

  return v_result;
end;
$$;

grant execute on function get_guarantee_alerts() to authenticated;
