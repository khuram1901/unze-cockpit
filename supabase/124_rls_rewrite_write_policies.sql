-- 124: Rewrite database write policies for ~20 tables that were left as
-- "allow anyone logged in" (found during the 15 Jul 2026 full-app audit,
-- Critical #12). These policies meant the app's actual permission rules
-- (who can edit what, PA exclusion, company separation) only existed in
-- the app's screens and API routes — anyone with a valid login could
-- write to these tables directly, bypassing every role check the app
-- enforces on screen.
--
-- Each table below is tightened to match the access rule the app ALREADY
-- enforces at the page/API level (see app/lib/permissions.ts), so this
-- should not change what anyone can legitimately do through the app —
-- it only closes the "go around the app and hit the database directly"
-- gap. Read (SELECT) policies were mostly left alone per the audit's own
-- scope note, EXCEPT where a table holds data covered by the standing
-- rule "PA never sees financial data. Ever" (pension/investments, tax
-- accounts) — those are tightened on read too, because leaving them open
-- directly contradicts that rule.
--
-- Every policy below is scoped `to authenticated` explicitly. This app's
-- tables have standard Supabase grants, which include the `anon` role —
-- a policy written without `to authenticated` applies to `anon` too, and
-- a check like `not is_pa()` evaluates to TRUE for a signed-out request
-- (no session = not PA). Scoping every policy to `authenticated` avoids
-- depending on each function happening to fail closed for a null session,
-- and keeps every one of these tables unreachable without a valid login,
-- same as before this migration.
--
-- Apply manually via the Supabase SQL Editor, per project convention.

-- ── New helper: mirrors app/lib/permissions.ts's isPA() exactly ──────
create or replace function public.is_pa()
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select
    lower(auth.email()) = 'pa.ceo@unze.co.uk'
    or get_user_role() = 'Executive';
$$;

-- ── tasks ─────────────────────────────────────────────────────────
-- Every legitimate task insert goes through /api/tasks/create, which
-- uses the service-role client (bypasses RLS entirely). No page or
-- route inserts directly as the logged-in user, so the client-facing
-- INSERT policy can simply be closed. UPDATE/DELETE/SELECT already had
-- real per-row scoping (can_access_all_tasks/is_task_assignee/assigned
-- email) and are left unchanged.
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (false);

-- ── Investments (pension) — PA may view, per Khuram's 15 Jul 2026
-- decision, but never write. All 5 tables here previously had a single
-- "true for authenticated" ALL policy, meaning ANY employee — not just
-- PA — could read and write this data. Writes only ever happen via
-- /api/investments/fetch-pension-prices using the service-role client.
drop policy if exists comp_funds_write on public.pension_comparison_funds;
create policy pension_comparison_funds_select on public.pension_comparison_funds
  for select to authenticated using (is_admin_tier() or is_pa());
create policy pension_comparison_funds_write on public.pension_comparison_funds
  for insert to authenticated with check (is_admin_tier());
create policy pension_comparison_funds_update on public.pension_comparison_funds
  for update to authenticated using (is_admin_tier());
create policy pension_comparison_funds_delete on public.pension_comparison_funds
  for delete to authenticated using (is_admin_tier());

drop policy if exists comp_prices_write on public.pension_comparison_prices;
create policy pension_comparison_prices_select on public.pension_comparison_prices
  for select to authenticated using (is_admin_tier() or is_pa());
create policy pension_comparison_prices_write on public.pension_comparison_prices
  for insert to authenticated with check (is_admin_tier());
create policy pension_comparison_prices_update on public.pension_comparison_prices
  for update to authenticated using (is_admin_tier());
create policy pension_comparison_prices_delete on public.pension_comparison_prices
  for delete to authenticated using (is_admin_tier());

drop policy if exists prices_write on public.pension_fund_prices;
create policy pension_fund_prices_select on public.pension_fund_prices
  for select to authenticated using (is_admin_tier() or is_pa());
create policy pension_fund_prices_write on public.pension_fund_prices
  for insert to authenticated with check (is_admin_tier());
create policy pension_fund_prices_update on public.pension_fund_prices
  for update to authenticated using (is_admin_tier());
create policy pension_fund_prices_delete on public.pension_fund_prices
  for delete to authenticated using (is_admin_tier());

drop policy if exists pension_write on public.pension_funds;
create policy pension_funds_select on public.pension_funds
  for select to authenticated using (is_admin_tier() or is_pa());
create policy pension_funds_write on public.pension_funds
  for insert to authenticated with check (is_admin_tier());
create policy pension_funds_update on public.pension_funds
  for update to authenticated using (is_admin_tier());
create policy pension_funds_delete on public.pension_funds
  for delete to authenticated using (is_admin_tier());

-- pension_contributions: no page or route anywhere in the app reads or
-- writes this table (confirmed by grep) — locking it to admin-tier is a
-- pure safety improvement with no functional impact today.
drop policy if exists contrib_write on public.pension_contributions;
create policy pension_contributions_select on public.pension_contributions
  for select to authenticated using (is_admin_tier() or is_pa());
create policy pension_contributions_write on public.pension_contributions
  for insert to authenticated with check (is_admin_tier());
create policy pension_contributions_update on public.pension_contributions
  for update to authenticated using (is_admin_tier());
create policy pension_contributions_delete on public.pension_contributions
  for delete to authenticated using (is_admin_tier());

-- ── Tax accounts/schedule — canViewTaxAccounts() excludes PA but allows
-- everyone else by default; the old "true for authenticated" policy did
-- not exclude PA. Tightened to match.
drop policy if exists tax_schedule_write on public.tax_schedule_entries;
create policy tax_schedule_entries_select on public.tax_schedule_entries
  for select to authenticated using (not is_pa());
create policy tax_schedule_entries_write on public.tax_schedule_entries
  for insert to authenticated with check (not is_pa());
create policy tax_schedule_entries_update on public.tax_schedule_entries
  for update to authenticated using (not is_pa());
create policy tax_schedule_entries_delete on public.tax_schedule_entries
  for delete to authenticated using (is_admin_tier());
-- Note: the finer rule "only admin-tier can unlock/reset a filed item"
-- is still enforced only in the UI (AccountsTaxDashboard.tsx), same as
-- before this migration — flagged here as a known limitation, not
-- something this migration attempts to fully close.

drop policy if exists tax_return_write on public.tax_return_filings;
create policy tax_return_filings_select on public.tax_return_filings
  for select to authenticated using (not is_pa());
create policy tax_return_filings_write on public.tax_return_filings
  for insert to authenticated with check (not is_pa());
create policy tax_return_filings_update on public.tax_return_filings
  for update to authenticated using (not is_pa());
create policy tax_return_filings_delete on public.tax_return_filings
  for delete to authenticated using (is_admin_tier());

-- tax_accounts_signoffs: the app hard-gates this to one person
-- (shakeel@unze.co.uk) client-side only, in AccountsTaxDashboard.tsx.
-- Enforced at the database now too.
drop policy if exists signoffs_write on public.tax_accounts_signoffs;
create policy tax_accounts_signoffs_select on public.tax_accounts_signoffs
  for select to authenticated using (not is_pa());
create policy tax_accounts_signoffs_write on public.tax_accounts_signoffs
  for insert to authenticated with check (lower(auth.email()) = 'shakeel@unze.co.uk' or is_admin_tier());
create policy tax_accounts_signoffs_update on public.tax_accounts_signoffs
  for update to authenticated using (lower(auth.email()) = 'shakeel@unze.co.uk' or is_admin_tier());
create policy tax_accounts_signoffs_delete on public.tax_accounts_signoffs
  for delete to authenticated using (is_admin_tier());

-- tax_deadline_alerts: only ever written by the server-side tax alert
-- engine (app/lib/taxAlertEngine.ts), via the service-role client. No
-- client-side write found anywhere.
drop policy if exists tax_alerts_write on public.tax_deadline_alerts;
create policy tax_deadline_alerts_select on public.tax_deadline_alerts
  for select to authenticated using (not is_pa());

-- ── Meetings — only reachable behind the /meetings page, gated by
-- useRequireCapability("meetings_admin") = isPrivileged. Reads kept
-- open to any logged-in user (meeting details aren't financial data
-- and are shown more broadly, e.g. to attendees) but no longer to
-- signed-out/anon requests.
drop policy if exists "Allow all for authenticated" on public.meetings;
create policy meetings_select on public.meetings
  for select to authenticated using (true);
create policy meetings_write on public.meetings
  for insert to authenticated with check (is_privileged());
create policy meetings_update on public.meetings
  for update to authenticated using (is_privileged());
create policy meetings_delete on public.meetings
  for delete to authenticated using (is_privileged());

drop policy if exists "Allow all for authenticated" on public.meeting_tasks;
create policy meeting_tasks_select on public.meeting_tasks
  for select to authenticated using (true);
create policy meeting_tasks_write on public.meeting_tasks
  for insert to authenticated with check (is_privileged());
create policy meeting_tasks_update on public.meeting_tasks
  for update to authenticated using (is_privileged());
create policy meeting_tasks_delete on public.meeting_tasks
  for delete to authenticated using (is_privileged());

-- meeting_attendees already has correctly-scoped SELECT/UPDATE (admin/
-- exec OR the attendee themself); only INSERT was wide open.
drop policy if exists attendees_write on public.meeting_attendees;
create policy meeting_attendees_write on public.meeting_attendees
  for insert to authenticated with check (is_privileged());

-- meeting_requests: INSERT stays open (self-service "request a
-- meeting", used by any employee from app/calendar/page.tsx). UPDATE
-- (approve/decline) is only ever done from app/pa/page.tsx, gated by
-- isPA(u) || isAdminTier(u).
drop policy if exists "Authenticated users can update meeting requests" on public.meeting_requests;
create policy meeting_requests_update on public.meeting_requests
  for update to authenticated using (is_pa() or is_admin_tier());

-- ── Production/ops — canAccessDailyEntry(u) = isAdminTier(u) ||
-- department === 'Unze Trading Ops'. UPDATE policies on
-- production_entries/dispatch_entries/breakage_entries already matched
-- this; INSERT did not. machine_issues had BOTH its update and delete
-- wide open to any authenticated user (anyone could edit or delete any
-- machine issue) — now matched to the same rule as the other tables.
drop policy if exists write_all on public.production_entries;
create policy production_entries_write on public.production_entries
  for insert to authenticated with check (is_admin_tier() or get_user_department() = 'Unze Trading Ops');

drop policy if exists write_all on public.dispatch_entries;
create policy dispatch_entries_write on public.dispatch_entries
  for insert to authenticated with check (is_admin_tier() or get_user_department() = 'Unze Trading Ops');

drop policy if exists write_all on public.breakage_entries;
create policy breakage_entries_write on public.breakage_entries
  for insert to authenticated with check (is_admin_tier() or get_user_department() = 'Unze Trading Ops');

drop policy if exists write_all on public.scrap_processed_entries;
create policy scrap_processed_entries_write on public.scrap_processed_entries
  for insert to authenticated with check (is_admin_tier() or get_user_department() = 'Unze Trading Ops');

drop policy if exists "Allow authenticated users to insert machine issues" on public.machine_issues;
create policy machine_issues_write on public.machine_issues
  for insert to authenticated with check (is_admin_tier() or get_user_department() = 'Unze Trading Ops');

drop policy if exists "Allow authenticated users to update machine issues" on public.machine_issues;
create policy machine_issues_update on public.machine_issues
  for update to authenticated using (is_admin_tier() or get_user_department() = 'Unze Trading Ops');

drop policy if exists "Allow authenticated users to delete machine issues" on public.machine_issues;
create policy machine_issues_delete on public.machine_issues
  for delete to authenticated using (is_admin_tier() or is_ops_manager());

-- dispatch_records / production_allocations: the newer "stock system"
-- tables. Every write goes through /api/stock/dispatch-records and
-- /api/stock/production-allocations, both using the service-role
-- client (bypasses RLS regardless of these policies). No client page
-- writes to them directly, so the client-facing write access is closed
-- entirely; SELECT stays open to any logged-in user (several report/
-- API routes read them without a stricter requirement identified) but,
-- same as above, no longer to signed-out/anon requests.
drop policy if exists dr_write on public.dispatch_records;
create policy dispatch_records_select on public.dispatch_records
  for select to authenticated using (true);

drop policy if exists pa_write on public.production_allocations;
create policy production_allocations_select on public.production_allocations
  for select to authenticated using (true);

-- ── Targets — canEditOperationsTargets(u) = isPrivileged(u) ||
-- email === nadeem.khan@unze.co.uk (the Ops HOD).
drop policy if exists "Allow authenticated users to insert monthly production targets" on public.monthly_production_targets;
create policy monthly_production_targets_write on public.monthly_production_targets
  for insert to authenticated with check (is_privileged() or lower(auth.email()) = 'nadeem.khan@unze.co.uk');
drop policy if exists "Allow authenticated users to update monthly production targets" on public.monthly_production_targets;
create policy monthly_production_targets_update on public.monthly_production_targets
  for update to authenticated using (is_privileged() or lower(auth.email()) = 'nadeem.khan@unze.co.uk');

drop policy if exists "Allow authenticated users to insert monthly dispatch targets" on public.monthly_dispatch_targets;
create policy monthly_dispatch_targets_write on public.monthly_dispatch_targets
  for insert to authenticated with check (is_privileged() or lower(auth.email()) = 'nadeem.khan@unze.co.uk');
drop policy if exists "Allow authenticated users to update monthly dispatch targets" on public.monthly_dispatch_targets;
create policy monthly_dispatch_targets_update on public.monthly_dispatch_targets
  for update to authenticated using (is_privileged() or lower(auth.email()) = 'nadeem.khan@unze.co.uk');

-- weekly_production_targets: confirmed by grep — no page or route in
-- the app references this table at all. Locked to admin-tier as a
-- safe default; nothing today depends on wider access.
drop policy if exists "Allow authenticated users to insert weekly production targets" on public.weekly_production_targets;
create policy weekly_production_targets_write on public.weekly_production_targets
  for insert to authenticated with check (is_admin_tier());
drop policy if exists "Allow authenticated users to update weekly production targets" on public.weekly_production_targets;
create policy weekly_production_targets_update on public.weekly_production_targets
  for update to authenticated using (is_admin_tier());

-- ── department_budgets — canEditFinance(u) = canViewFinance(u) =
-- isAdminTier(u) || (role='Manager' && department='Finance'), PA
-- excluded. Existing DELETE policy already correct; INSERT/UPDATE were
-- both wide open.
drop policy if exists budget_insert on public.department_budgets;
create policy department_budgets_write on public.department_budgets
  for insert to authenticated with check (is_admin_tier() or is_finance_manager());
drop policy if exists budget_update on public.department_budgets;
create policy department_budgets_update on public.department_budgets
  for update to authenticated using (is_admin_tier() or is_finance_manager());

-- ── department_owners — only ever written from app/members/MembersManager.tsx,
-- behind useRequireCapability("members") = isPrivileged.
drop policy if exists "Allow authenticated users to update department owners" on public.department_owners;
create policy department_owners_update on public.department_owners
  for update to authenticated using (is_privileged());

-- ── notification_log — written only server-side (send-email.ts,
-- meetings inbox-check route), always via the service-role client.
-- No client-side write found anywhere.
drop policy if exists "Allow all for authenticated" on public.notification_log;
create policy notification_log_select on public.notification_log
  for select to authenticated using (true);

-- ── audit_log — self-logging is intentional (any authenticated user
-- logs their OWN actions via lib/audit-log.ts), but nothing stopped a
-- user from writing a log row claiming to be someone else. Now
-- requires the row's user_email to match the caller's own session
-- email.
drop policy if exists audit_log_write on public.audit_log;
create policy audit_log_write on public.audit_log
  for insert to authenticated with check (lower(user_email) = lower(auth.email()));

-- ── exceptions — only reachable behind app/exceptions/page.tsx, gated
-- by useRequireCapability("exceptions") = isPrivileged. SELECT left
-- unchanged (out of this migration's scope per the audit's own note
-- that reads weren't reviewed).
drop policy if exists "Allow authenticated users to insert exceptions" on public.exceptions;
create policy exceptions_write on public.exceptions
  for insert to authenticated with check (is_privileged());
drop policy if exists "Allow authenticated users to update exceptions" on public.exceptions;
create policy exceptions_update on public.exceptions
  for update to authenticated using (is_privileged());
