-- Phase 4: get_production_summary was called by the home page briefing and
-- the CEO dashboard but NEVER existed in the database — both callers have
-- been silently getting nulls (production % blank, daily target 0).
-- Semantics from the call sites:
--   prod_total_yesterday — poles produced on p_date (31+36+45, matching the
--     dashboard trend chart's unit; meters excluded — different unit)
--   targ_total_month     — sum of monthly_production_targets 31+36+45 for p_month
--   daily_target         — monthly target / days in that month, rounded
-- Applied via Supabase MCP 30/08/2026.
create or replace function public.get_production_summary(
  p_month text,
  p_date date default null
)
returns table (
  prod_total_yesterday numeric,
  targ_total_month numeric,
  daily_target numeric
)
language sql
security definer
set search_path = public
as $$
  with targ as (
    select coalesce(sum(coalesce(target_31,0) + coalesce(target_36,0) + coalesce(target_45,0)), 0) as total
    from monthly_production_targets
    where target_month = p_month
  ),
  prod as (
    select coalesce(sum(coalesce(qty_31,0) + coalesce(qty_36,0) + coalesce(qty_45,0)), 0) as total
    from production_entries
    where p_date is not null and entry_date = p_date
  ),
  dim as (
    select extract(day from (date_trunc('month', to_date(p_month || '-01', 'YYYY-MM-DD')) + interval '1 month - 1 day'))::numeric as days
  )
  select prod.total, targ.total,
         case when targ.total > 0 then round(targ.total / dim.days) else 0 end
  from targ, prod, dim;
$$;

revoke execute on function public.get_production_summary(text, date) from public, anon;
grant execute on function public.get_production_summary(text, date) to authenticated, service_role;
