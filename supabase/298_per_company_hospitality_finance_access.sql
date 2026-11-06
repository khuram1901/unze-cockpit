-- Migration 298: Per-company hospitality finance access
-- 06/11/2026
--
-- Splits can_view_restaurants_pnl into 3 per-company keys so Baranh/HD/KKJ
-- managers can be given access to only their own company's finance page.
-- Existing can_view_restaurants_pnl column is kept for the Hospitality P&L
-- (restaurants summary) page — that remains a single gate.

ALTER TABLE member_permissions
  ADD COLUMN IF NOT EXISTS can_view_baranh_finance     boolean,
  ADD COLUMN IF NOT EXISTS can_view_haute_dolci_finance boolean,
  ADD COLUMN IF NOT EXISTS can_view_kk_jhang_finance   boolean;
