-- 133: Add kamran@unze.co.uk to is_admin_tier()
-- This allows Kamran (secondary CEO) to sign off tax accounts and perform
-- all write operations that require admin-tier access.

CREATE OR REPLACE FUNCTION public.is_admin_tier()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT
    auth.email() IN ('k.saleem@unzegroup.com', 'khuram1901@gmail.com', 'kamran@unze.co.uk')
    OR get_user_role() = 'Admin';
$$;
