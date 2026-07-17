-- 091_rls_performance_2.sql
--
-- Follow-up to 090_rls_performance.sql — three tables the first advisor
-- pass missed, same exact pattern as nine tables already fixed in 090
-- (tax_accounts_signoffs, tax_deadline_alerts, tax_return_filings,
-- tax_schedule_entries, dispatch_records, pension_comparison_funds,
-- pension_comparison_prices, pension_funds, recurring_tasks):
--
-- Each of these three tables has a "_write" policy scoped to ALL commands
-- with condition `true` (unconditional access for any authenticated user)
-- AND a separate "_read" policy scoped to SELECT only, ALSO with
-- condition `true`. Confirmed live via pg_policies immediately before
-- writing this file — both conditions are word-for-word identical
-- (qual = true on both), so the _read policy adds zero additional
-- restriction; it's pure duplication that Postgres has to evaluate on
-- every read for no reason.
--
-- This migration ONLY drops the redundant _read policy on each table.
-- The _write policy (unchanged) continues to grant the exact same
-- unconditional authenticated access to SELECT/INSERT/UPDATE/DELETE that
-- existed before. No access is added or removed for anyone.
--
-- Apply via Supabase SQL Editor.

begin;

drop policy if exists contrib_read on public.pension_contributions;
drop policy if exists prices_read on public.pension_fund_prices;
drop policy if exists pa_read on public.production_allocations;

commit;
