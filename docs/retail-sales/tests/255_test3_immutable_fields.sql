-- =============================================================================
-- TEST 3a + 3b: immutable fields (store_id, sales_date) cannot be changed
--
-- Verifies that the BEFORE UPDATE trigger uses IS DISTINCT FROM on all
-- immutable columns and raises an exception if any are changed.
-- (The NULL-safe check matters because <> with NULL evaluates to NULL,
--  silently not firing — IS DISTINCT FROM always returns a boolean.)
--
-- PRE-CONDITIONS:
--   * Migration 255 parts 1 + 2 must be applied.
--   * One active daily_sales row must exist.
--   * At least two stores must exist (for the store_id swap in 3a).
--
-- HOW TO RUN:
--   In Supabase SQL Editor using the service role (default).
--   Replace <STORE_ID> and <ROW_ID> with real UUIDs before running.
--
-- EXPECTED OUTPUT:
--   NOTICE: PASS 3a: store_id blocked — daily_sales.store_id is immutable
--   NOTICE: PASS 3b: sales_date blocked — daily_sales.sales_date is immutable
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TEST 3a: store_id is immutable
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_other_store uuid;
BEGIN
  -- Pick any store that is NOT the row's current store
  SELECT id INTO v_other_store
  FROM public.stores
  WHERE id <> '<STORE_ID>'::uuid
  LIMIT 1;

  IF v_other_store IS NULL THEN
    RAISE EXCEPTION 'SETUP ERROR: need at least 2 stores to run test 3a';
  END IF;

  UPDATE public.daily_sales
     SET store_id = v_other_store
   WHERE id = '<ROW_ID>'::uuid;

  RAISE EXCEPTION 'FAIL 3a: store_id change should have been rejected by the trigger';

EXCEPTION
  WHEN OTHERS THEN
    IF sqlerrm LIKE '%store_id is immutable%' THEN
      RAISE NOTICE 'PASS 3a: store_id blocked — %', sqlerrm;
    ELSE
      RAISE;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- TEST 3b: sales_date is immutable
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  UPDATE public.daily_sales
     SET sales_date = sales_date - 1
   WHERE id = '<ROW_ID>'::uuid;

  RAISE EXCEPTION 'FAIL 3b: sales_date change should have been rejected by the trigger';

EXCEPTION
  WHEN OTHERS THEN
    IF sqlerrm LIKE '%sales_date is immutable%' THEN
      RAISE NOTICE 'PASS 3b: sales_date blocked — %', sqlerrm;
    ELSE
      RAISE;
    END IF;
END $$;
