-- Migration 270: Bank Facilities (guarantees) RLS tighten — 17/10/2026
--
-- Findings from the /finance/guarantees page audit:
--   INSERT policies had no condition and UPDATE/DELETE policies allowed
--   ANY Manager and the Executive (PA) role to write directly through the
--   Supabase client, bypassing the API's permission checks.
--
-- Not changed here (shared with other finance tables, migration 015):
--   is_finance_manager() still matches department = 'Finance', which no
--   longer exists. Fixing it is a separate, cross-page decision.
--
-- The app only ever writes these tables through the API routes (service
-- role), so direct authenticated writes are removed entirely. Reads stay
-- admin-tier / Finance & Tax managers (the page itself goes via the API,
-- which honours the Access Matrix toggles).

-- Applied to production 17/10/2026 via ALTER POLICY (the policies are kept
-- but can never match), which is simpler to roll back than DROP.

begin;

alter policy admin_insert_guarantees on public.guarantees with check (false);
alter policy admin_update_guarantees on public.guarantees using (false) with check (false);
alter policy admin_delete_guarantees on public.guarantees using (false);

alter policy admin_insert_guarantee_facilities on public.guarantee_facilities with check (false);
alter policy admin_update_guarantee_facilities on public.guarantee_facilities using (false) with check (false);
alter policy admin_delete_guarantee_facilities on public.guarantee_facilities using (false);

commit;

-- ─── ROLLBACK ────────────────────────────────────────────────────────────────
-- begin;
-- alter policy admin_insert_guarantees on public.guarantees with check (true);
-- alter policy admin_update_guarantees on public.guarantees
--   using (exists (select 1 from members where members.email = (select auth.email()) and members.role = any (array['Admin','Executive','Manager'])))
--   with check (true);
-- alter policy admin_delete_guarantees on public.guarantees
--   using (exists (select 1 from members where members.email = (select auth.email()) and members.role = any (array['Admin','Executive','Manager'])));
-- alter policy admin_insert_guarantee_facilities on public.guarantee_facilities with check (true);
-- alter policy admin_update_guarantee_facilities on public.guarantee_facilities
--   using (exists (select 1 from members where members.email = (select auth.email()) and members.role = any (array['Admin','Executive','Manager'])))
--   with check (true);
-- alter policy admin_delete_guarantee_facilities on public.guarantee_facilities
--   using (exists (select 1 from members where members.email = (select auth.email()) and members.role = any (array['Admin','Executive','Manager'])));
-- commit;
