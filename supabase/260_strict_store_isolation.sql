-- Migration 260: strict store isolation
--
-- Two changes that close server-side identity gaps in the Retail Sales module:
--
-- 1. retail_store_for_user() — adds email equality check so the function can
--    only return a store whose email matches the caller's JWT email. A store###
--    email that isn't in the 33 stores, or whose email doesn't match the JWT,
--    gets NULL → no access.
--
-- 2. store_users trigger — rejects any INSERT/UPDATE on store_users where
--    auth.users.email ≠ stores.email (case-insensitive). This prevents an
--    admin mistake from linking a user to the wrong store at the DB level.
--
-- APPLY AFTER migrations 254, 255, 256, 257 are confirmed applied.
-- Run this via Supabase SQL Editor. Never auto-run.
--
-- VERIFICATION:
--   See the DO block at the bottom — it asserts function + trigger exist.

BEGIN;

-- ── 1. Tighten retail_store_for_user() ──────────────────────────────────────
--
-- Add:  AND lower(s.email) = lower(auth.email())
--
-- auth.email() returns the email from the caller's JWT session.
-- For admin/service-role calls (no user session) this returns NULL, which
-- causes the equality to evaluate to NULL (false) → no store returned.
-- That is correct: admin calls should derive store explicitly, not via this
-- function.

CREATE OR REPLACE FUNCTION public.retail_store_for_user()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
  SELECT su.store_id
  FROM   public.store_users su
  JOIN   public.stores s ON s.id = su.store_id
  WHERE  su.user_id  = auth.uid()
    AND  su.is_primary
    AND  s.is_active
    AND  lower(s.email) = lower(auth.email())   -- ← NEW: email must match JWT
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.retail_store_for_user() IS
  'Returns the store_id for the current authenticated store user. '
  'Requires: active store_users row for auth.uid(), is_primary=true, '
  'store is active, AND store.email = JWT email (case-insensitive). '
  'Returns NULL for HOD/FM/admin callers and for storeXXX emails not in 33 stores.';

-- ── 2. Trigger: enforce email match on store_users ───────────────────────────
--
-- Fires BEFORE INSERT OR UPDATE on store_users.
-- Looks up auth.users.email for NEW.user_id and stores.email for NEW.store_id.
-- Raises EXCEPTION if they don't match (case-insensitive).
-- SECURITY DEFINER so it can read auth.users even from anon/authenticated callers.

CREATE OR REPLACE FUNCTION public.store_users_email_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_email  text;
  v_store_email text;
BEGIN
  -- Fetch the user's email from auth.users
  SELECT lower(au.email)
    INTO v_user_email
    FROM auth.users au
   WHERE au.id = NEW.user_id;

  IF v_user_email IS NULL THEN
    RAISE EXCEPTION
      'store_users: user % not found in auth.users — link rejected', NEW.user_id;
  END IF;

  -- Fetch the store's registered email
  SELECT lower(s.email)
    INTO v_store_email
    FROM public.stores s
   WHERE s.id = NEW.store_id;

  IF v_store_email IS NULL THEN
    RAISE EXCEPTION
      'store_users: store % not found or has no email — link rejected', NEW.store_id;
  END IF;

  -- Reject if emails don't match
  IF v_user_email <> v_store_email THEN
    RAISE EXCEPTION
      'store_users: user email (%) does not match store email (%) — link rejected',
      v_user_email, v_store_email;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.store_users_email_check() FROM PUBLIC, anon;

COMMENT ON FUNCTION public.store_users_email_check() IS
  'Trigger function: rejects store_users INSERT/UPDATE if the user email in '
  'auth.users does not match the store email in stores (case-insensitive).';

-- Drop and recreate trigger (idempotent)
DROP TRIGGER IF EXISTS store_users_email_match_check ON public.store_users;

CREATE TRIGGER store_users_email_match_check
  BEFORE INSERT OR UPDATE ON public.store_users
  FOR EACH ROW EXECUTE FUNCTION public.store_users_email_check();

COMMENT ON TRIGGER store_users_email_match_check ON public.store_users IS
  'Enforces that store_users.user_id email matches store_users.store_id email. '
  'Prevents cross-store links at the database level.';

-- ── 3. Verification ──────────────────────────────────────────────────────────

DO $$
DECLARE
  v_fn_exists      boolean;
  v_trig_fn_exists boolean;
  v_trig_exists    boolean;
  v_fn_has_email   boolean;
BEGIN
  -- retail_store_for_user() exists
  SELECT true INTO v_fn_exists
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'retail_store_for_user';

  IF NOT FOUND OR NOT v_fn_exists THEN
    RAISE EXCEPTION '260 ASSERTION FAILED: retail_store_for_user() not found';
  END IF;

  -- store_users_email_check() trigger function exists
  SELECT true INTO v_trig_fn_exists
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'store_users_email_check';

  IF NOT FOUND OR NOT v_trig_fn_exists THEN
    RAISE EXCEPTION '260 ASSERTION FAILED: store_users_email_check() not found';
  END IF;

  -- Trigger exists on store_users
  SELECT true INTO v_trig_exists
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'store_users'
    AND t.tgname = 'store_users_email_match_check';

  IF NOT FOUND OR NOT v_trig_exists THEN
    RAISE EXCEPTION '260 ASSERTION FAILED: trigger store_users_email_match_check not found on store_users';
  END IF;

  -- retail_store_for_user() body contains the email check
  SELECT (prosrc ILIKE '%lower(s.email)%') INTO v_fn_has_email
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'retail_store_for_user';

  IF NOT v_fn_has_email THEN
    RAISE EXCEPTION '260 ASSERTION FAILED: retail_store_for_user() does not contain email check';
  END IF;

  RAISE NOTICE '260 OK: retail_store_for_user() tightened with email check';
  RAISE NOTICE '260 OK: store_users_email_check() trigger function created';
  RAISE NOTICE '260 OK: trigger store_users_email_match_check on store_users';
END $$;

COMMIT;

-- ── ROLLBACK ─────────────────────────────────────────────────────────────────
-- To undo:
--
-- 1. Remove email check from retail_store_for_user():
--    Edit the function body: remove the line:
--      AND lower(s.email) = lower(auth.email())
--
-- 2. Drop the trigger and function:
--    DROP TRIGGER IF EXISTS store_users_email_match_check ON public.store_users;
--    DROP FUNCTION IF EXISTS public.store_users_email_check();
