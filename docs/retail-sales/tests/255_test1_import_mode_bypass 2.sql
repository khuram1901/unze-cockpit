-- =============================================================================
-- TEST 1a: import_mode bypass blocked for store users
--
-- Verifies that a store user (authenticated role) who sets
-- retail_sales.import_mode='true' in their session and attempts to INSERT
-- with source='excel_import' / status='imported' / import_batch_id set is
-- silently corrected to source='manual', status='submitted', import_batch_id=NULL.
--
-- PRE-CONDITIONS:
--   * Migration 255 parts 1 + 2 must be applied.
--   * One active store with an opening balance row must exist.
--   * A store_users row mapping the test user to that store must exist.
--
-- HOW TO RUN:
--   In Supabase SQL Editor: switch role to the store user's auth JWT
--   (Settings → SQL Editor → "Run as user" and paste the JWT), then run.
--   Replace <STORE_ID> with the store's UUID before running.
--
-- EXPECTED OUTPUT:
--   NOTICE: PASS 1a: import_mode bypass blocked — source=manual, status=submitted, batch=<NULL>
-- =============================================================================

DO $$
DECLARE
  v_source  text;
  v_status  text;
  v_batch   uuid;
BEGIN
  -- Store user attempts to activate import_mode (only honoured under service role)
  PERFORM set_config('retail_sales.import_mode', 'true', true);

  INSERT INTO public.daily_sales (
    store_id, sales_date,
    source, status, import_batch_id,
    submitted_by, submitted_at
  ) VALUES (
    '<STORE_ID>'::uuid,
    current_date,
    'excel_import',      -- trigger must override → 'manual'
    'imported',          -- trigger must override → 'submitted'
    gen_random_uuid(),   -- trigger must clear → NULL
    auth.uid(),
    now()
  )
  RETURNING source, status, import_batch_id
    INTO v_source, v_status, v_batch;

  ASSERT v_source = 'manual',
    format('FAIL 1a source: expected manual, got %s', v_source);
  ASSERT v_status = 'submitted',
    format('FAIL 1a status: expected submitted, got %s', v_status);
  ASSERT v_batch IS NULL,
    format('FAIL 1a batch: expected NULL, got %s', v_batch);

  RAISE NOTICE 'PASS 1a: import_mode bypass blocked — source=%, status=%, batch=%',
    v_source, v_status, v_batch;

  -- Clean up the test row
  DELETE FROM public.daily_sales
  WHERE store_id = '<STORE_ID>'::uuid
    AND sales_date = current_date
    AND deleted_at IS NULL;
END $$;
