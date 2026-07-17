-- Migration 118: Add the missing can_refresh_investment_prices column
--
-- Found during the 15 Jul 2026 full-app audit: app/lib/permissions.ts's
-- canRefreshInvestmentPrices() and app/members/AccessMatrix.tsx both
-- read/write an override key called "can_refresh_investment_prices",
-- but the member_permissions table never actually had this column —
-- the Access Matrix checkbox for "Inv Refresh" has been non-functional
-- since it was added (any toggle there silently does nothing, because
-- there's no column for it to land in).
--
-- This matters right now because of a same-day decision: Khuram granted
-- PA (Sundas) both view and refresh access to Investments verbally on
-- 12 Jul 2026; during this audit he decided to pull "refresh" back to
-- admin-tier-only in code, but wants it to stay toggleable per-person
-- via the Access Matrix in case it's needed again later. That promise
-- only works if the column actually exists.
--
-- Apply via Supabase SQL Editor.

begin;

alter table public.member_permissions
  add column if not exists can_refresh_investment_prices boolean;

commit;
