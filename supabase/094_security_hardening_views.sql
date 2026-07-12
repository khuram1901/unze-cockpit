-- 094_security_hardening_views.sql
--
-- portfolio_summary and current_prices are two views exposing real
-- investment data (holdings.ticker/quantity/buy_price/target_price,
-- derived cost basis, current value, gain/loss). Confirmed live:
--   relacl showed anon=arwdDxtm — anon had full read (and nominal
--   write) access, meaning anyone with the public anon key, no login
--   required, could query these two views directly and get Khuram's
--   real portfolio. Confirmed via full codebase search that nothing in
--   the app queries these views directly — every page uses the
--   get_portfolio_summary_full() RPC instead, which is unaffected by
--   this migration.
--
-- Two changes, both scoped to just these two views:
--
-- 1. security_invoker = true — views default to running with their
--    OWNER's privileges (bypassing RLS on the tables they read from).
--    This flips that off, so if anything ever does query these views
--    with a real user session in future, the normal RLS rules on
--    holdings/price_history apply instead of being silently bypassed.
--
-- 2. Revoke all access from anon AND authenticated — nothing in the
--    app needs either role to read these two views directly, so there
--    is no reason for any live grant here. service_role (used by every
--    API route) and the postgres owner role are untouched and keep
--    full access.
--
-- Apply via Supabase SQL Editor.

begin;

alter view public.portfolio_summary set (security_invoker = true);
alter view public.current_prices set (security_invoker = true);

revoke all on public.portfolio_summary from anon, authenticated;
revoke all on public.current_prices from anon, authenticated;

commit;
