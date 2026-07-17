-- 127: Rule-0 cleanup (15 Jul 2026 audit) — replaces the JS loops in
-- app/monthly-operations-targets/page.tsx that summed raw
-- production_entries/dispatch_entries rows per plant in the browser.
-- The monthly target rows themselves (monthly_production_targets/
-- monthly_dispatch_targets) are still fetched directly — that's a
-- small, per-plant lookup used to prefill the edit form, not an
-- aggregation. Only the actuals summation moves here.
--
-- Apply manually via the Supabase SQL Editor, per project convention.

create or replace function get_monthly_plant_actuals(p_month_start date, p_month_end date)
returns table (
  plant_id     uuid,
  prod_actual  numeric,
  disp_actual  numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with prod as (
    select plant_id, sum(coalesce(qty_31, 0) + coalesce(qty_36, 0) + coalesce(qty_45, 0) + coalesce(qty_meter, 0)) as total
    from production_entries
    where entry_date >= p_month_start and entry_date <= p_month_end
    group by plant_id
  ),
  disp as (
    select plant_id, sum(coalesce(qty_31, 0) + coalesce(qty_36, 0) + coalesce(qty_45, 0) + coalesce(qty_meter, 0)) as total
    from dispatch_entries
    where entry_date >= p_month_start and entry_date <= p_month_end
    group by plant_id
  )
  select
    coalesce(prod.plant_id, disp.plant_id) as plant_id,
    coalesce(prod.total, 0) as prod_actual,
    coalesce(disp.total, 0) as disp_actual
  from prod
  full outer join disp on disp.plant_id = prod.plant_id;
$$;

grant execute on function get_monthly_plant_actuals(date, date) to authenticated;
