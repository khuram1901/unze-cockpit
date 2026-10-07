-- Migration 257: member_permissions — can_access_daily_sales column
--
-- Adds the can_access_daily_sales boolean to member_permissions.
-- This flag marks a member as a retail store user who is:
--   • Redirected to /daily-sales on every page load (enforced client-side via STORE_USER_RE)
--   • Blocked from all standard app pages (useAuthGuard + app/page.tsx)
--   • Shown in the Members page with a simplified drawer (no widget/capability toggles)
--
-- DEFAULT NULL follows the existing member_permissions convention:
--   NULL  = not a store user (use role-based access as normal)
--   TRUE  = store user — restricted to /daily-sales only
--   FALSE = explicitly NOT a store user (rare; use if an email happens to match STORE_USER_RE)
--
-- The client-side STORE_USER_RE regex (/^store\d{3}@unze\.co\.uk$/) is the primary
-- enforcement mechanism. This column is the DB-visible record of that status, allowing:
--   1. The Access Matrix to display store-user status for admins
--   2. Future server-side checks that don't rely on email pattern matching
--   3. The Members page filter ("Store users") to be DB-driven rather than regex-only
--
-- APPLY AFTER:
--   • Migration 254 (retail_stores.sql) has been applied via SQL Editor
--
-- BACKFILL:
--   After the 33 store accounts are created (STOP condition B — explicit go-ahead required),
--   backfill with:
--     UPDATE member_permissions mp
--     SET can_access_daily_sales = TRUE
--     FROM members m
--     WHERE mp.member_id = m.id
--       AND m.email ~ '^store[0-9]{3}@unze\.co\.uk$';
--
-- Apply manually in Supabase SQL Editor. Never auto-run.

BEGIN;

-- 1. Add the column (idempotent)
ALTER TABLE member_permissions
  ADD COLUMN IF NOT EXISTS can_access_daily_sales boolean DEFAULT NULL;

COMMENT ON COLUMN member_permissions.can_access_daily_sales IS
  'TRUE = retail store user (redirected to /daily-sales, blocked from all other pages). '
  'NULL = standard member (use role-based access). '
  'FALSE = explicitly not a store user (overrides email pattern if needed).';

-- 2. Assertion: column exists and is nullable (DEFAULT NULL, not NOT NULL)
DO $$
DECLARE
  v_col_exists boolean;
  v_is_nullable boolean;
BEGIN
  SELECT
    true,
    (is_nullable = 'YES')
  INTO v_col_exists, v_is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'member_permissions'
    AND column_name  = 'can_access_daily_sales';

  IF NOT FOUND OR NOT v_col_exists THEN
    RAISE EXCEPTION '257 ASSERTION FAILED: member_permissions.can_access_daily_sales column not found';
  END IF;

  IF NOT v_is_nullable THEN
    RAISE EXCEPTION '257 ASSERTION FAILED: member_permissions.can_access_daily_sales should be nullable (DEFAULT NULL)';
  END IF;

  RAISE NOTICE '257 OK: member_permissions.can_access_daily_sales column exists and is nullable';
END $$;

COMMIT;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- To undo this migration, run:
--
--   ALTER TABLE member_permissions DROP COLUMN IF EXISTS can_access_daily_sales;
