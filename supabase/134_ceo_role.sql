-- 134: Introduce a real "CEO" role
--
-- Before this migration, "CEO" wasn't a role at all — it was two hardcoded
-- email addresses (k.saleem@unzegroup.com, kamran@unze.co.uk) baked directly
-- into permissions.ts (isCEO/isSecondaryCEO) AND into this database's
-- is_admin_tier() function. That meant:
--   1. Kamran's members.role column said "Member" (misleading — his real
--      access came entirely from the email match, not this field).
--   2. The Access Matrix UI treats every PROTECTED_EMAILS entry as fully
--      locked/read-only, and Kamran was on that list purely because he was
--      hardcoded as a CEO email — so Khuram could not toggle a single one
--      of his permissions through the UI. Every change had to go through a
--      direct database edit.
--   3. Adding a third person with "CEO-like" access would have required a
--      code change, not a click.
--
-- This migration makes "CEO" a first-class role value, reassigns the two
-- CEO accounts to it, and updates the database-level admin check to match.
-- khuram1901@gmail.com stays role='Admin' — the one true locked, absolute
-- account. Everyone else with senior access (k.saleem@unzegroup.com,
-- kamran@unze.co.uk, and anyone added in future) is role='CEO': full
-- rights by default, but a normal role subject to the same
-- member_permissions override matrix as Manager/Member — Khuram can now
-- dial back what any individual CEO-tier person sees, through the UI.

-- 1. Allow 'CEO' as a role value.
alter table public.members drop constraint if exists members_role_check;
alter table public.members add constraint members_role_check
  check (role = any (array['Admin'::text, 'CEO'::text, 'Executive'::text, 'Manager'::text, 'Member'::text]));

-- 2. Reassign the two CEO accounts. khuram1901@gmail.com is untouched.
update public.members set role = 'CEO' where email = 'k.saleem@unzegroup.com';
update public.members set role = 'CEO' where email = 'kamran@unze.co.uk';

-- 3. Database-level admin check: role-based instead of a hardcoded email
-- list (this is what migration 133 had introduced for Kamran specifically —
-- superseded here by making it role-driven for anyone who is or ever
-- becomes CEO, without needing another migration each time).
CREATE OR REPLACE FUNCTION public.is_admin_tier()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT get_user_role() IN ('Admin', 'CEO');
$$;
