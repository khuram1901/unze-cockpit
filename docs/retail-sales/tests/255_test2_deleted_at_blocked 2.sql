-- =============================================================================
-- TEST 2: direct UPDATE setting deleted_at is rejected without soft_delete_mode
--
-- Verifies that any UPDATE on daily_sales that sets deleted_at is blocked by
-- the BEFORE UPDATE trigger unless retail_sales.soft_delete_mode='true' is set
-- in the session — which only soft_delete_daily_sale() (part 3, SECURITY DEFINER)
-- can activate alongside the correct widget check.
--
-- PRE-CONDITIONS:
--   * Migration 255 parts 1 + 2 must be applied.
--   * One active daily_sales row must exist (not already soft-deleted).
--
-- HOW TO RUN:
--   In Supabase SQL Editor using the service role (default).
--   Replace <ROW_ID> with a real daily_sales.id UUID before running.
--
-- EXPECTED OUTPUT:
--   NOTICE: PASS 2: deleted_at blocked — <error message containing 'deleted_at may only be set'>
-- =============================================================================

DO $$
BEGIN
  -- soft_delete_mode is NOT set in this session
  UPDATE public.daily_sales
     SET deleted_at = now()
   WHERE id = '<ROW_ID>'::uuid;

  -- If we reach here the trigger did not fire — test fails
  RAISE EXCEPTION 'FAIL 2: UPDATE should have been rejected by the BEFORE UPDATE trigger';

EXCEPTION
  WHEN OTHERS THEN
    IF sqlerrm LIKE '%deleted_at may only be set%' THEN
      RAISE NOTICE 'PASS 2: deleted_at blocked — %', sqlerrm;
    ELSE
      RAISE;   -- unexpected error, re-raise so it is visible
    END IF;
END $$;
