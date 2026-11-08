-- Migration 304: Unze London UK finance access + Ilford Exchange store
-- Applied: 2026-11-08
--
-- 1. Add can_view_unze_london_finance column to member_permissions.
--    Gate for /finance/unze-london (Xero CashFlow).
--    Same pattern as migration 299 (UTPL/Imperial). PA always blocked;
--    Admin/CEO always allowed; everyone else needs an explicit grant.
--
-- 2. Add can_view_uzl_pnl column to member_permissions.
--    Gate for /finance/unze-london-pnl (Xero P&L). Same rules.
--
-- 3. Insert Ilford Exchange into stores (FM code 005).
--    admin_location_id is NULL — no Pakistan admin location for UK stores.
--    Daily sales entry is not yet set up for this store.

-- 1. CashFlow permission column
ALTER TABLE public.member_permissions
  ADD COLUMN IF NOT EXISTS can_view_unze_london_finance BOOLEAN DEFAULT NULL;

COMMENT ON COLUMN public.member_permissions.can_view_unze_london_finance
  IS 'Grants access to /finance/unze-london (Xero CashFlow). PA always blocked. NULL = role default (Admin/CEO = true, others = false).';

-- 2. P&L permission column
ALTER TABLE public.member_permissions
  ADD COLUMN IF NOT EXISTS can_view_uzl_pnl BOOLEAN DEFAULT NULL;

COMMENT ON COLUMN public.member_permissions.can_view_uzl_pnl
  IS 'Grants access to /finance/unze-london-pnl (Xero P&L). PA always blocked. NULL = role default (Admin/CEO = true, others = false).';

-- 2. Ilford Exchange store
INSERT INTO public.stores (fm_code, name, email, admin_location_id, pnl_branch_name, manual_entry_start_date, is_active)
VALUES ('005', 'Ilford Exchange', 'store005@unze.co.uk', NULL, 'Ilford Exchange', '2026-11-08', true)
ON CONFLICT DO NOTHING;
