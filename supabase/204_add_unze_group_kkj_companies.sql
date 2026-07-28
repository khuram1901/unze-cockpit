-- Migration 204: Add Unze Group and K&K Jhang to the companies table
-- Confirmed 28/07/2026:
--   Unze Group (UXG) — group-level umbrella entity; HR, Admin, IT departments
--     belong here, not to individual subsidiary companies.
--   K&K Jhang (KKJ) — real company but used for accounts/tax returns only;
--     no cash pipeline, no payroll, no task tagging.

INSERT INTO companies (id, name, short_code, currency, created_at)
VALUES
  ('c5ef2967-f06c-4302-b74f-0c096f482ffa', 'Unze Group',  'UXG', 'PKR', now()),
  ('4e515021-b63f-478b-a69e-90be3d8367c7', 'K&K Jhang',   'KKJ', 'PKR', now())
ON CONFLICT (id) DO NOTHING;
