-- 090_rls_performance.sql
--
-- Fixes the two performance-category findings from the Supabase advisor
-- (Database → Advisors → Performance). Both are about RLS policies, not
-- about "too many databases" — this is one project, one database. See
-- CHANGELOG.md for the plain-English explanation given to Khuram.
--
-- PART A — auth_rls_initplan (17 policies)
--   Postgres was re-running auth.email() / auth.role() for EVERY ROW
--   checked by a query, instead of once per query. Wrapping the call as
--   (select auth.email()) lets Postgres cache the result once and reuse
--   it — same permission logic, same result, just faster on any table
--   scan of more than a handful of rows.
--
-- PART B — multiple_permissive_policies (24 policies)
--   Several tables had a "read" policy (SELECT-only) AND a "write" policy
--   scoped to ALL commands (which already includes SELECT). Postgres has
--   to evaluate both on every read and OR the results together — pure
--   waste. Fixed by either (a) dropping the read policy where the write
--   policy already grants the same or broader access, or (b) narrowing
--   the write policy to INSERT/UPDATE/DELETE only where its condition is
--   stricter than the read policy's, so each command is covered by
--   exactly one policy.
--
-- PART C — duplicate_index (1 index)
--   department_owners had two identical UNIQUE constraints on the same
--   column — pure duplication, doubling write cost for no benefit.
--
-- Apply via Supabase SQL Editor. Read-only in effect (no data changes,
-- no access changes) — every rewritten policy keeps the exact same
-- permission logic as before, just expressed more efficiently.

begin;

-- =========================================================================
-- PART A — auth_rls_initplan: wrap bare auth.*() calls in (select ...)
-- =========================================================================

-- tasks
alter policy tasks_delete on public.tasks
  using (is_admin_or_exec() or (assigned_to_email = (select auth.email())));

alter policy tasks_select on public.tasks
  using (
    can_access_all_tasks()
    or (assigned_to_email = (select auth.email()))
    or (assigned_by = (select members.name from members where members.email = (select auth.email())))
  );

alter policy tasks_update on public.tasks
  using (can_access_all_tasks() or (assigned_to_email = (select auth.email())));

-- holdings
alter policy holdings_admin_delete on public.holdings
  using (
    ((select auth.email()) = any (array['khuram1901@gmail.com'::text, 'k.saleem@unzegroup.com'::text]))
    or (get_user_role() = 'Admin'::text)
  );

alter policy holdings_admin_write on public.holdings
  with check (
    ((select auth.email()) = any (array['khuram1901@gmail.com'::text, 'k.saleem@unzegroup.com'::text]))
    or (get_user_role() = 'Admin'::text)
  );

alter policy holdings_admin_update on public.holdings
  using (
    ((select auth.email()) = any (array['khuram1901@gmail.com'::text, 'k.saleem@unzegroup.com'::text]))
    or (get_user_role() = 'Admin'::text)
  );

-- push_subscriptions
alter policy push_sub_own_delete on public.push_subscriptions
  using (user_email = (select auth.email()));

alter policy push_sub_own_insert on public.push_subscriptions
  with check (user_email = (select auth.email()));

alter policy push_sub_own_select on public.push_subscriptions
  using (user_email = (select auth.email()));

-- meeting_attendees
alter policy attendees_read on public.meeting_attendees
  using (is_admin_or_exec() or (member_email = (select auth.email())));

alter policy attendees_update on public.meeting_attendees
  using (is_admin_or_exec() or (member_email = (select auth.email())));

-- receivable_stage_history
alter policy rsh_insert on public.receivable_stage_history
  with check ((select auth.role()) = 'authenticated'::text);

alter policy rsh_read_all on public.receivable_stage_history
  using ((select auth.role()) = 'authenticated'::text);

-- price_history
alter policy price_history_admin_write on public.price_history
  with check (
    ((select auth.email()) = any (array['khuram1901@gmail.com'::text, 'k.saleem@unzegroup.com'::text]))
    or (get_user_role() = 'Admin'::text)
  );

alter policy price_history_admin_update on public.price_history
  using (
    ((select auth.email()) = any (array['khuram1901@gmail.com'::text, 'k.saleem@unzegroup.com'::text]))
    or (get_user_role() = 'Admin'::text)
  );

-- guarantee_facilities & guarantees: these also need the multiple-policy
-- split (Part B), so they're rewritten together below rather than here.

-- =========================================================================
-- PART B — multiple_permissive_policies
-- =========================================================================

-- --- B1: tables where the SELECT-only policy is fully redundant because
-- the ALL policy already grants the identical (or broader) access.
-- Simplest fix: drop the redundant read policy, nothing else changes.

drop policy if exists signoffs_read on public.tax_accounts_signoffs;
drop policy if exists tax_alerts_read on public.tax_deadline_alerts;
drop policy if exists tax_return_read on public.tax_return_filings;
drop policy if exists tax_schedule_read on public.tax_schedule_entries;
drop policy if exists dr_read on public.dispatch_records;
drop policy if exists comp_funds_read on public.pension_comparison_funds;
drop policy if exists comp_prices_read on public.pension_comparison_prices;
drop policy if exists pension_read on public.pension_funds;
drop policy if exists recurring_read on public.recurring_tasks;

-- --- B2: tables where the ALL policy is *stricter* than the read policy
-- (admin/manager-only write vs. open-to-everyone read). Can't just drop
-- the read policy here — instead narrow the ALL write policy down to
-- INSERT/UPDATE/DELETE only, so SELECT is handled solely by the read
-- policy and the two never overlap.

-- companies (roles: public)
drop policy if exists companies_write on public.companies;

create policy companies_insert on public.companies
  for insert to public
  with check (is_admin_or_exec());

create policy companies_update on public.companies
  for update to public
  using (is_admin_or_exec())
  with check (is_admin_or_exec());

create policy companies_delete on public.companies
  for delete to public
  using (is_admin_or_exec());

-- authority_letters
drop policy if exists al_write on public.authority_letters;

create policy al_insert on public.authority_letters
  for insert to authenticated
  with check (is_admin_or_exec() or (get_user_role() = 'Manager'::text));

create policy al_update on public.authority_letters
  for update to authenticated
  using (is_admin_or_exec() or (get_user_role() = 'Manager'::text))
  with check (is_admin_or_exec() or (get_user_role() = 'Manager'::text));

create policy al_delete on public.authority_letters
  for delete to authenticated
  using (is_admin_or_exec() or (get_user_role() = 'Manager'::text));

-- contractors
drop policy if exists con_write on public.contractors;

create policy con_insert on public.contractors
  for insert to authenticated
  with check (is_admin_or_exec() or (get_user_role() = 'Manager'::text));

create policy con_update on public.contractors
  for update to authenticated
  using (is_admin_or_exec() or (get_user_role() = 'Manager'::text))
  with check (is_admin_or_exec() or (get_user_role() = 'Manager'::text));

create policy con_delete on public.contractors
  for delete to authenticated
  using (is_admin_or_exec() or (get_user_role() = 'Manager'::text));

-- opening_stock_allocations
drop policy if exists osa_write on public.opening_stock_allocations;

create policy osa_insert on public.opening_stock_allocations
  for insert to authenticated
  with check (is_admin_or_exec() or (get_user_role() = 'Manager'::text));

create policy osa_update on public.opening_stock_allocations
  for update to authenticated
  using (is_admin_or_exec() or (get_user_role() = 'Manager'::text))
  with check (is_admin_or_exec() or (get_user_role() = 'Manager'::text));

create policy osa_delete on public.opening_stock_allocations
  for delete to authenticated
  using (is_admin_or_exec() or (get_user_role() = 'Manager'::text));

-- po_contractors
drop policy if exists poc_write on public.po_contractors;

create policy poc_insert on public.po_contractors
  for insert to authenticated
  with check (is_admin_or_exec() or (get_user_role() = 'Manager'::text));

create policy poc_update on public.po_contractors
  for update to authenticated
  using (is_admin_or_exec() or (get_user_role() = 'Manager'::text))
  with check (is_admin_or_exec() or (get_user_role() = 'Manager'::text));

create policy poc_delete on public.po_contractors
  for delete to authenticated
  using (is_admin_or_exec() or (get_user_role() = 'Manager'::text));

-- purchase_orders
drop policy if exists po_write on public.purchase_orders;

create policy po_insert on public.purchase_orders
  for insert to authenticated
  with check (is_admin_or_exec() or (get_user_role() = 'Manager'::text));

create policy po_update on public.purchase_orders
  for update to authenticated
  using (is_admin_or_exec() or (get_user_role() = 'Manager'::text))
  with check (is_admin_or_exec() or (get_user_role() = 'Manager'::text));

create policy po_delete on public.purchase_orders
  for delete to authenticated
  using (is_admin_or_exec() or (get_user_role() = 'Manager'::text));

-- guarantee_facilities — also has a bare auth.email() inside its EXISTS
-- check (Part A), so it's rewritten fully here rather than via ALTER.
drop policy if exists admin_write_guarantee_facilities on public.guarantee_facilities;

create policy admin_insert_guarantee_facilities on public.guarantee_facilities
  for insert to authenticated
  with check (
    exists (
      select 1 from members
      where members.email = (select auth.email())
        and members.role = any (array['Admin'::text, 'Executive'::text, 'Manager'::text])
    )
  );

create policy admin_update_guarantee_facilities on public.guarantee_facilities
  for update to authenticated
  using (
    exists (
      select 1 from members
      where members.email = (select auth.email())
        and members.role = any (array['Admin'::text, 'Executive'::text, 'Manager'::text])
    )
  )
  with check (
    exists (
      select 1 from members
      where members.email = (select auth.email())
        and members.role = any (array['Admin'::text, 'Executive'::text, 'Manager'::text])
    )
  );

create policy admin_delete_guarantee_facilities on public.guarantee_facilities
  for delete to authenticated
  using (
    exists (
      select 1 from members
      where members.email = (select auth.email())
        and members.role = any (array['Admin'::text, 'Executive'::text, 'Manager'::text])
    )
  );

-- guarantees — same treatment as guarantee_facilities
drop policy if exists admin_write_guarantees on public.guarantees;

create policy admin_insert_guarantees on public.guarantees
  for insert to authenticated
  with check (
    exists (
      select 1 from members
      where members.email = (select auth.email())
        and members.role = any (array['Admin'::text, 'Executive'::text, 'Manager'::text])
    )
  );

create policy admin_update_guarantees on public.guarantees
  for update to authenticated
  using (
    exists (
      select 1 from members
      where members.email = (select auth.email())
        and members.role = any (array['Admin'::text, 'Executive'::text, 'Manager'::text])
    )
  )
  with check (
    exists (
      select 1 from members
      where members.email = (select auth.email())
        and members.role = any (array['Admin'::text, 'Executive'::text, 'Manager'::text])
    )
  );

create policy admin_delete_guarantees on public.guarantees
  for delete to authenticated
  using (
    exists (
      select 1 from members
      where members.email = (select auth.email())
        and members.role = any (array['Admin'::text, 'Executive'::text, 'Manager'::text])
    )
  );

-- =========================================================================
-- PART C — duplicate_index
-- =========================================================================

-- department_owners has two identical UNIQUE constraints on department_name
-- (department_owners_department_name_key and department_owners_department_unique).
-- Keep the original, drop the duplicate.
alter table public.department_owners drop constraint if exists department_owners_department_unique;

commit;
