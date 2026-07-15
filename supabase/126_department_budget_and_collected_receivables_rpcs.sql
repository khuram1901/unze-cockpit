-- 126: Rule-0 cleanup (found during the 15 Jul 2026 full-app audit) —
-- moves two more JS aggregations into the database.
--
-- Apply manually via the Supabase SQL Editor, per project convention.

-- ── 1. Department budget per-department + grand totals ──────────────
-- Replaces the budgets.reduce(...) / hand-built Map grouping in
-- app/finance/FinanceManager.tsx and app/finance/page.tsx. The raw
-- per-category rows are still fetched separately for the editable
-- list (each row has its own inline "Actual" input) — only the SUMS
-- move here.
create or replace function get_department_budget_summary(p_company_id uuid, p_month text)
returns table (
  department      text,
  budgeted_total   numeric,
  actual_total     numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    department,
    sum(coalesce(budgeted_amount, 0)) as budgeted_total,
    sum(coalesce(actual_amount, 0))   as actual_total
  from department_budgets
  where company_id = p_company_id
    and budget_month = p_month
  group by department
  order by department;
$$;

grant execute on function get_department_budget_summary(uuid, text) to authenticated;


-- ── 2. Collected receivables grouped by plant ────────────────────────
-- Replaces the hand-built Map grouping in app/receivables/page.tsx's
-- collectedByPlant. Also fixes a side issue: the JS version only ever
-- grouped the most recent 100 collected bills (the client fetch was
-- capped), so plant totals were already silently incomplete once more
-- than 100 bills had been collected in total. This computes true
-- totals over ALL collected bills, and returns only the most recent
-- p_bills_per_plant per plant (as JSON) for the on-screen preview list,
-- matching what the UI already shows (first 5 + "N more").
create or replace function get_collected_receivables_by_plant(p_bills_per_plant int default 5)
returns table (
  plant_name   text,
  bill_count   bigint,
  total_amount numeric,
  bills        json
)
language sql
stable
security definer
set search_path = public
as $$
  with collected as (
    select
      coalesce(p.name, 'Unknown') as plant_name,
      r.id, r.utility, r.amount, r.received_date, r.plant_id
    from receivables r
    left join plants p on p.id = r.plant_id
    where r.status = 'Collected'
  ),
  ranked as (
    select *,
      row_number() over (partition by plant_name order by received_date desc nulls last) as rn
    from collected
  )
  select
    c.plant_name,
    count(*)                    as bill_count,
    sum(coalesce(c.amount, 0))  as total_amount,
    (
      select json_agg(json_build_object('id', r.id, 'utility', r.utility, 'amount', r.amount, 'received_date', r.received_date) order by r.received_date desc nulls last)
      from ranked r
      where r.plant_name = c.plant_name and r.rn <= p_bills_per_plant
    ) as bills
  from collected c
  group by c.plant_name
  order by sum(coalesce(c.amount, 0)) desc;
$$;

grant execute on function get_collected_receivables_by_plant(int) to authenticated;
