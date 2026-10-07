-- Migration 258: seed widget overrides for retail-sales access
-- imperial.retail_sales  → 6 members (can submit + edit daily sales)
-- imperial.retail_sales_hod → 3 members (can soft-delete + reopen months)
--
-- Uses ON CONFLICT DO NOTHING so safe to re-run if rows already exist.
-- Rows are keyed on (member_id, widget_key); member looked up by email.
--
-- Apply via Supabase SQL Editor. No rollback needed (idempotent).

INSERT INTO public.member_widget_overrides (member_id, widget_key, visible)
SELECT m.id, 'imperial.retail_sales', true
FROM public.members m
WHERE lower(m.email) IN (
  'k.saleem@unzegroup.com',
  'kamran@unze.co.uk',
  'accounts@unzegroup.com',
  'operations@unzegroup.com',
  'logistics@unzegroup.com',
  'retail@unzegroup.com'
)
ON CONFLICT (member_id, widget_key) DO NOTHING;

INSERT INTO public.member_widget_overrides (member_id, widget_key, visible)
SELECT m.id, 'imperial.retail_sales_hod', true
FROM public.members m
WHERE lower(m.email) IN (
  'k.saleem@unzegroup.com',
  'kamran@unze.co.uk',
  'accounts@unzegroup.com'
)
ON CONFLICT (member_id, widget_key) DO NOTHING;
