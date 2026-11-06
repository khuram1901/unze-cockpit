-- Migration 299: per-company finance access for Unze Trading (UTPL) and Imperial (IFPL)
--
-- Adds two new boolean columns to member_permissions so a user can be
-- granted access to only the Unze Trading or Imperial finance page without
-- holding the full finance role or company scope.
--
-- The Imperial toggle grants Finance Overview only — the Retail Sales tab
-- remains gated by the separate imperial.retail_sales widget.
--
-- Mirrors the pattern introduced in migration 298 for the three restaurant
-- companies (Baranh, Haute Dolci, K&K Jhang).

ALTER TABLE member_permissions
  ADD COLUMN IF NOT EXISTS can_view_unze_trading_finance boolean,
  ADD COLUMN IF NOT EXISTS can_view_imperial_finance     boolean;
