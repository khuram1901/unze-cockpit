-- 092_security_hardening_1.sql
--
-- Two safe, verified security fixes from the advisor's security-category
-- findings. Both are additive restrictions only — nothing is granted,
-- nothing that currently works stops working. See CHANGELOG.md.
--
-- PART A — search_path hardening (14 functions)
--   These are the small permission-check helpers used all over the
--   app's RLS policies (is_admin_or_exec, get_user_role, etc). They
--   predate the project's own rule ("RPCs must always have security
--   definer and set search_path = public") — this just brings them
--   into line with every RPC written since. No behaviour change.
--
-- PART B — revoke anonymous access to 33 data-returning functions
--   Supabase grants EXECUTE on every new function to the "anon" role
--   (unauthenticated / logged-out) by default unless explicitly
--   revoked. These 33 functions return real business data — the CEO
--   digest, portfolio summaries, receivables, guarantees, Folder-it
--   documents — and were still open to that default grant, meaning
--   someone with just the public anon key and no login could call them
--   directly via Supabase's REST API.
--
--   Verified this is safe to revoke: every API route uses the private
--   service-role key (bypasses this grant system entirely), and every
--   place the app calls these from the browser (app/home/page.tsx,
--   app/investments/page.tsx, app/receivables/page.tsx, etc.) only
--   does so after Supabase Auth login — which runs as "authenticated",
--   a completely separate role from "anon". "authenticated" keeps full
--   access; nothing logged-in changes.
--
--   Deliberately NOT touching the 16 small is_*/can_*/get_user_role/
--   get_user_department/perm_override/sync_member_permissions helper
--   functions here — those are referenced *inside* other tables' RLS
--   policies (some scoped to the Postgres "public" pseudo-role, which
--   covers anon too), and revoking anon's execute on them could turn a
--   clean "zero rows" denial into a hard permission-denied error for
--   any such policy check. That needs its own careful review, not a
--   blanket revoke — tracked separately, not rushed into this file.
--
-- Apply via Supabase SQL Editor.

begin;

-- =========================================================================
-- PART A — search_path hardening
-- =========================================================================

alter function public.can_access_all_tasks() set search_path = public;
alter function public.can_access_receivables() set search_path = public;
alter function public.can_manage_members_rls() set search_path = public;
alter function public.can_see_company_finance(target_company uuid) set search_path = public;
alter function public.can_view_audit_log_rls() set search_path = public;
alter function public.get_user_department() set search_path = public;
alter function public.get_user_role() set search_path = public;
alter function public.is_admin_or_exec() set search_path = public;
alter function public.is_admin_tier() set search_path = public;
alter function public.is_finance_manager() set search_path = public;
alter function public.is_ops_manager() set search_path = public;
alter function public.is_privileged() set search_path = public;
alter function public.perm_override(col_name text) set search_path = public;
alter function public.sync_member_permissions() set search_path = public;

-- =========================================================================
-- PART B — revoke anon EXECUTE on data-returning functions
-- =========================================================================

revoke execute on function public.get_ceo_daily_digest(p_emails text[]) from anon;
revoke execute on function public.get_company_cash_yearly_comparison(p_company_id uuid, p_month text) from anon;
revoke execute on function public.get_contractor_performance(p_plant_id uuid) from anon;
revoke execute on function public.get_daily_ops_snapshot(p_today date, p_yesterday date) from anon;
revoke execute on function public.get_facility_synopsis() from anon;
revoke execute on function public.get_facility_used(p_facility_id uuid, p_exclude_guarantee_id uuid) from anon;
revoke execute on function public.get_folderit_company_breakdown() from anon;
revoke execute on function public.get_folderit_details(p_user_email text, p_company_uuid uuid, p_include_company_inbox boolean) from anon;
revoke execute on function public.get_folderit_file_account(p_file_uid text) from anon;
revoke execute on function public.get_folderit_hr_categories() from anon;
revoke execute on function public.get_folderit_hr_category_files(p_category_name text) from anon;
revoke execute on function public.get_folderit_hr_inbox() from anon;
revoke execute on function public.get_folderit_overdue_items(p_threshold_days integer) from anon;
revoke execute on function public.get_folderit_summary(p_user_email text, p_company_uuid uuid) from anon;
revoke execute on function public.get_guarantee_summary() from anon;
revoke execute on function public.get_monthly_po_snapshot(p_month_start date, p_month_end date) from anon;
revoke execute on function public.get_pension_comparison_performance() from anon;
revoke execute on function public.get_pension_fund_breakdown() from anon;
revoke execute on function public.get_pension_fund_movement() from anon;
revoke execute on function public.get_pension_summary() from anon;
revoke execute on function public.get_plant_kpis(as_of_date date, month_start date, month_end date) from anon;
revoke execute on function public.get_portfolio_daily_summary(p_as_of date, p_prev_date date, p_alert_pct numeric, p_div_days integer) from anon;
revoke execute on function public.get_portfolio_summary_as_of(as_of date) from anon;
revoke execute on function public.get_portfolio_summary_full(p_as_of date, p_alert_pct numeric, p_div_days integer) from anon;
revoke execute on function public.get_psx_stock_movement() from anon;
revoke execute on function public.get_receivable_aging_by_customer() from anon;
revoke execute on function public.get_receivable_aging_totals() from anon;
revoke execute on function public.get_receivable_rag_by_customer() from anon;
revoke execute on function public.get_stock_summary(p_plant_id uuid) from anon;
revoke execute on function public.get_upcoming_dividends(p_days_ahead integer) from anon;
revoke execute on function public.get_weekly_ops_snapshot(p_since date, p_today date) from anon;
revoke execute on function public.search_folderit_hr_files(p_query text) from anon;
revoke execute on function public.search_receivables_for_guarantee(p_search text) from anon;

commit;
