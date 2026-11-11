-- Migration 304: Enable RLS on flw_tax_adjustments_keep
-- This backup table containing sensitive employee tax data had RLS disabled,
-- flagged by Supabase security advisor on 08 Nov 2026.
-- No app routes query this table directly — service role bypasses RLS.
-- Enabling with no permissive policies = anon/authenticated have zero access.

ALTER TABLE public.flw_tax_adjustments_keep ENABLE ROW LEVEL SECURITY;
