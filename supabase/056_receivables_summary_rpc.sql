-- Migration 056: Receivables summary RPC
-- Replaces JS loops that computed RAG status, aging buckets, and customer
-- grouping from raw receivable rows. Returns three pre-aggregated result sets
-- in one round trip instead of downloading all bill rows to the browser.
--
-- Apply manually in Supabase SQL Editor. No tables are modified.

-- ── 1. Per-customer RAG summary ──────────────────────────────────────────────
create or replace function get_receivable_rag_by_customer()
returns table (
  customer        text,
  green_amount    numeric,
  amber_amount    numeric,
  red_amount      numeric,
  total_amount    numeric,
  red_count       bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with stage_budgets as (
    select stage_order, working_day_budget
    from receivable_stages
  ),
  -- Working days since a date, Mon-Fri, exclusive of start day inclusive of today
  bills_with_rag as (
    select
      coalesce(r.utility, 'Unknown') as customer,
      coalesce(r.amount, 0)          as amount,
      case
        when sb.working_day_budget <= 0 then 'green'
        when (
          select count(*)
          from generate_series(
            r.current_stage_entered_date::date,
            current_date,
            '1 day'::interval
          ) d
          where extract(dow from d) not in (0, 6)
            and d::date > r.current_stage_entered_date::date
        ) >= sb.working_day_budget then 'red'
        when (
          select count(*)
          from generate_series(
            r.current_stage_entered_date::date,
            current_date,
            '1 day'::interval
          ) d
          where extract(dow from d) not in (0, 6)
            and d::date > r.current_stage_entered_date::date
        ) >= sb.working_day_budget - 1 then 'amber'
        else 'green'
      end as rag
    from receivables r
    left join stage_budgets sb on sb.stage_order = r.current_stage_order
    where r.status <> 'Collected'
  )
  select
    customer,
    sum(case when rag = 'green' then amount else 0 end) as green_amount,
    sum(case when rag = 'amber' then amount else 0 end) as amber_amount,
    sum(case when rag = 'red'   then amount else 0 end) as red_amount,
    sum(amount)                                          as total_amount,
    count(case when rag = 'red' then 1 end)              as red_count
  from bills_with_rag
  group by customer
  order by sum(case when rag = 'red' then amount else 0 end) desc,
           sum(amount) desc;
$$;

grant execute on function get_receivable_rag_by_customer() to authenticated;


-- ── 2. Aging totals (overall) ─────────────────────────────────────────────────
create or replace function get_receivable_aging_totals()
returns table (
  bucket   text,
  total    numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when (current_date - date_submitted::date) <= 30 then '0-30'
      when (current_date - date_submitted::date) <= 60 then '31-60'
      when (current_date - date_submitted::date) <= 90 then '61-90'
      else '90+'
    end as bucket,
    sum(coalesce(amount, 0)) as total
  from receivables
  where status <> 'Collected'
    and date_submitted is not null
  group by 1
  order by min(current_date - date_submitted::date);
$$;

grant execute on function get_receivable_aging_totals() to authenticated;


-- ── 3. Aging by customer ──────────────────────────────────────────────────────
create or replace function get_receivable_aging_by_customer()
returns table (
  customer  text,
  b0_30     numeric,
  b31_60    numeric,
  b61_90    numeric,
  b90_plus  numeric,
  total     numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(utility, 'Unknown')                                             as customer,
    sum(case when (current_date - date_submitted::date) <= 30  then coalesce(amount, 0) else 0 end) as b0_30,
    sum(case when (current_date - date_submitted::date) <= 60
              and (current_date - date_submitted::date) > 30   then coalesce(amount, 0) else 0 end) as b31_60,
    sum(case when (current_date - date_submitted::date) <= 90
              and (current_date - date_submitted::date) > 60   then coalesce(amount, 0) else 0 end) as b61_90,
    sum(case when (current_date - date_submitted::date) > 90   then coalesce(amount, 0) else 0 end) as b90_plus,
    sum(coalesce(amount, 0))                                                 as total
  from receivables
  where status <> 'Collected'
    and date_submitted is not null
  group by 1
  order by sum(coalesce(amount, 0)) desc;
$$;

grant execute on function get_receivable_aging_by_customer() to authenticated;
