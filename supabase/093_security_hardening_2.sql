-- 093_security_hardening_2.sql
--
-- Correction to 092_security_hardening_1.sql — Part B of that migration
-- (revoke anon EXECUTE) ran without error but had NO actual effect.
-- Verified this directly against the live database before writing this
-- file: Postgres grants EXECUTE on every new function to the "PUBLIC"
-- pseudo-role (i.e. literally everyone) by default at creation time,
-- unless explicitly revoked. These 33 functions were never given the
-- "anon" role its own individual grant — anon was only ever getting in
-- through that default PUBLIC door, which REVOKE ... FROM anon does
-- not touch. Nothing broke from the first attempt, but nothing was
-- actually fixed either.
--
-- The real fix: revoke from PUBLIC itself. Confirmed via pg_proc.proacl
-- on all 33 functions that "authenticated" and "service_role" each hold
-- their OWN separate, explicit grant already (not inherited via
-- PUBLIC) — e.g. get_ceo_daily_digest's ACL is exactly:
--   {=X/postgres, postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
-- The "=X/postgres" entry (blank role name before "=") is the PUBLIC
-- grant being removed here. "authenticated=X/postgres" and
-- "service_role=X/postgres" are untouched by this — logged-in users
-- and every API route keep working exactly as before.
--
-- Apply via Supabase SQL Editor.

begin;

revoke execute on function public.get_ceo_daily_digest(p_emails text[]) from public;
revoke execute on function public.get_company_cash_yearly_comparison(p_company_id uuid, p_month text) from public;
revoke execute on function public.get_contractor_performance(p_plant_id uuid) from public;
revoke execute on function public.get_daily_ops_snapshot(p_today date, p_yesterday date) from public;
revoke execute on function public.get_facility_synopsis() from public;
revoke execute on function public.get_facility_used(p_facility_id uuid, p_exclude_guarantee_id uuid) from public;
revoke execute on function public.get_folderit_company_breakdown() from public;
revoke execute on function public.get_folderit_details(p_user_email text, p_company_uuid uuid, p_include_company_inbox boolean) from public;
revoke execute on function public.get_folderit_file_account(p_file_uid text) from public;
revoke execute on function public.get_folderit_hr_categories() from public;
revoke execute on function public.get_folderit_hr_category_files(p_category_name text) from public;
revoke execute on function public.get_folderit_hr_inbox() from public;
revoke execute on function public.get_folderit_overdue_items(p_threshold_days integer) from public;
revoke execute on function public.get_folderit_summary(p_user_email text, p_company_uuid uuid) from public;
revoke execute on function public.get_guarantee_summary() from public;
revoke execute on function public.get_monthly_po_snapshot(p_month_start date, p_month_end date) from public;
revoke execute on function public.get_pension_comparison_performance() from public;
revoke execute on function public.get_pension_fund_breakdown() from public;
revoke execute on function public.get_pension_fund_movement() from public;
revoke execute on function public.get_pension_summary() from public;
revoke execute on function public.get_plant_kpis(as_of_date date, month_start date, month_end date) from public;
revoke execute on function public.get_portfolio_daily_summary(p_as_of date, p_prev_date date, p_alert_pct numeric, p_div_days integer) from public;
revoke execute on function public.get_portfolio_summary_as_of(as_of date) from public;
revoke execute on function public.get_portfolio_summary_full(p_as_of date, p_alert_pct numeric, p_div_days integer) from public;
revoke execute on function public.get_psx_stock_movement() from public;
revoke execute on function public.get_receivable_aging_by_customer() from public;
revoke execute on function public.get_receivable_aging_totals() from public;
revoke execute on function public.get_receivable_rag_by_customer() from public;
revoke execute on function public.get_stock_summary(p_plant_id uuid) from public;
revoke execute on function public.get_upcoming_dividends(p_days_ahead integer) from public;
revoke execute on function public.get_weekly_ops_snapshot(p_since date, p_today date) from public;
revoke execute on function public.search_folderit_hr_files(p_query text) from public;
revoke execute on function public.search_receivables_for_guarantee(p_search text) from public;

commit;
