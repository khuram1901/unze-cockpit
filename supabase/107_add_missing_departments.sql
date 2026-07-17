-- 107_add_missing_departments.sql
--
-- Khuram gave the full department list for task tagging: HR, Admin,
-- Audit, Accounts, Finance, Tax, Retail, Marketing, Online, Executive
-- Office, Procurement/Purchase.
--
-- HR, Admin, Audit and Finance already exist in department_owners.
-- This adds the 7 that were missing (which is why they weren't showing
-- up as options on the New Task / Edit Task department dropdowns).
--
-- Owners are left NULL for now — Khuram, please assign a primary owner
-- for each of these via the Members page (where the other departments'
-- owners are already managed) when you get a chance. Until then these
-- departments are selectable but won't have an owner shown.
--
-- NOTE: department_owners already has 5 rows not on Khuram's list (BINC,
-- Legal, S&M Investment, Sales, Unze Trading Ops). Those are left
-- untouched — removing them wasn't asked for, and Unze Trading Ops in
-- particular is actively used by existing tasks, so deleting it would
-- break those tags.

insert into public.department_owners (department_name, active)
values
  ('Accounts', true),
  ('Tax', true),
  ('Retail', true),
  ('Marketing', true),
  ('Online', true),
  ('Executive Office', true),
  ('Procurement / Purchase', true)
on conflict do nothing;
