-- =============================================================================
-- MIGRATION 255 — PART 2 of 4
-- Triggers: BEFORE INSERT guard, BEFORE UPDATE guard, AFTER INSERT/UPDATE
-- audit backstop on daily_sales and store_opening_balances.
-- Depends on part 1 (retail_settings, is_month_locked, daily_sales, audit).
-- Final 255 = parts 1-4 in one BEGIN/COMMIT.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. BEFORE INSERT trigger on daily_sales
--    Enforces provenance, date limits, lock, and opening-balance presence.
--    All client-supplied values for provenance fields are ignored and overwritten.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.daily_sales_before_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_tz              text;
  v_backdate_days   int;
  v_import_start    date;
  v_import_cutoff   date;
  v_today           date;
  v_store_active    boolean;
  v_store_entry_start date;
  v_ob_opening_date date;
  v_import_mode     boolean;
BEGIN
  -- 1. Always overwrite provenance; client values are never trusted.
  NEW.submitted_by  := auth.uid();
  NEW.submitted_at  := now();
  NEW.updated_by    := NULL;
  NEW.updated_at    := NULL;
  NEW.deleted_at    := NULL;
  NEW.deleted_by    := NULL;
  NEW.delete_reason := NULL;
  NEW.bank_reconciled  := NULL;
  NEW.sap_reconciled   := NULL;
  NEW.variance         := NULL;

  -- 2. Determine path: import or manual.
  --    Import is allowed only when the session local is set AND the caller is
  --    a service-role function (current_user <> 'authenticated').
  v_import_mode := (
    current_setting('retail_sales.import_mode', true) = 'true'
    AND current_user <> 'authenticated'
  );

  -- 3. Read retail_settings once.
  SELECT value      INTO v_tz             FROM public.retail_settings WHERE key = 'timezone';
  SELECT value::int INTO v_backdate_days  FROM public.retail_settings WHERE key = 'store_backdate_days';
  SELECT value::date INTO v_import_start  FROM public.retail_settings WHERE key = 'import_start_date';
  SELECT value::date INTO v_import_cutoff FROM public.retail_settings WHERE key = 'import_cutoff_date';
  v_tz            := COALESCE(v_tz, 'Asia/Karachi');
  v_backdate_days := COALESCE(v_backdate_days, 7);

  -- Today in the configured timezone.
  v_today := (now() AT TIME ZONE v_tz)::date;

  -- 4. Path-specific provenance + date rules.
  IF v_import_mode THEN
    -- Import path: allow excel_import; enforce date range from settings.
    IF NEW.source <> 'excel_import' THEN
      RAISE EXCEPTION 'retail_sales.import_mode is active but source is not excel_import (got: %)', NEW.source;
    END IF;
    IF NEW.import_batch_id IS NULL THEN
      RAISE EXCEPTION 'Import path requires import_batch_id to be set';
    END IF;
    NEW.status := 'imported';
    IF NEW.sales_date < v_import_start THEN
      RAISE EXCEPTION 'Import date % is before import_start_date %', NEW.sales_date, v_import_start;
    END IF;
    IF NEW.sales_date > v_import_cutoff THEN
      RAISE EXCEPTION 'Import date % is after import_cutoff_date %', NEW.sales_date, v_import_cutoff;
    END IF;
  ELSE
    -- Manual path: force correct provenance; apply backdate and entry-start limits.
    NEW.source          := 'manual';
    NEW.status          := 'submitted';
    NEW.import_batch_id := NULL;

    -- Store must be active.
    SELECT is_active, manual_entry_start_date
      INTO v_store_active, v_store_entry_start
      FROM public.stores
     WHERE id = NEW.store_id;
    IF NOT FOUND OR NOT v_store_active THEN
      RAISE EXCEPTION 'Store % is not active', NEW.store_id;
    END IF;

    -- sales_date must not be in the future.
    IF NEW.sales_date > v_today THEN
      RAISE EXCEPTION 'sales_date % is in the future (today is % in %)', NEW.sales_date, v_today, v_tz;
    END IF;

    -- sales_date must be within the backdate window.
    IF NEW.sales_date < v_today - v_backdate_days THEN
      RAISE EXCEPTION 'sales_date % is more than % days in the past (today is % in %)',
        NEW.sales_date, v_backdate_days, v_today, v_tz;
    END IF;

    -- sales_date must not precede the store's manual entry start date.
    IF NEW.sales_date < v_store_entry_start THEN
      RAISE EXCEPTION 'sales_date % is before this store''s manual_entry_start_date %',
        NEW.sales_date, v_store_entry_start;
    END IF;
  END IF;

  -- 5. Both paths: opening balance must exist and sales_date >= opening_date.
  SELECT opening_date
    INTO v_ob_opening_date
    FROM public.store_opening_balances
   WHERE store_id = NEW.store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No opening balance set for store %. Set one before entering sales data.', NEW.store_id;
  END IF;
  IF NEW.sales_date < v_ob_opening_date THEN
    RAISE EXCEPTION 'sales_date % is before this store''s opening_date %', NEW.sales_date, v_ob_opening_date;
  END IF;

  -- 6. Both paths: month must not be locked (unless an active reopen exists).
  IF public.is_month_locked(NEW.store_id, NEW.sales_date) THEN
    RAISE EXCEPTION 'Month % is locked for store %. A HOD must reopen it first.',
      date_trunc('month', NEW.sales_date)::date, NEW.store_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER daily_sales_before_insert
  BEFORE INSERT ON public.daily_sales
  FOR EACH ROW EXECUTE FUNCTION public.daily_sales_before_insert();

REVOKE ALL ON FUNCTION public.daily_sales_before_insert() FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- B. BEFORE UPDATE trigger on daily_sales
--    Guards immutable fields, enforces soft-delete mode, checks lock.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.daily_sales_before_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_soft_delete_mode boolean;
BEGIN
  -- 1. These columns are immutable after insert.
  --    IS DISTINCT FROM is used throughout — <> with NULL evaluates to NULL (not TRUE),
  --    causing the IF branch to silently not execute when either side is NULL.
  IF NEW.id            IS DISTINCT FROM OLD.id            THEN RAISE EXCEPTION 'daily_sales.id is immutable'; END IF;
  IF NEW.store_id      IS DISTINCT FROM OLD.store_id      THEN RAISE EXCEPTION 'daily_sales.store_id is immutable'; END IF;
  IF NEW.sales_date    IS DISTINCT FROM OLD.sales_date    THEN RAISE EXCEPTION 'daily_sales.sales_date is immutable'; END IF;
  IF NEW.submitted_by  IS DISTINCT FROM OLD.submitted_by  THEN RAISE EXCEPTION 'daily_sales.submitted_by is immutable'; END IF;
  IF NEW.submitted_at  IS DISTINCT FROM OLD.submitted_at  THEN RAISE EXCEPTION 'daily_sales.submitted_at is immutable'; END IF;
  IF NEW.source        IS DISTINCT FROM OLD.source        THEN RAISE EXCEPTION 'daily_sales.source is immutable'; END IF;
  IF NEW.import_batch_id IS DISTINCT FROM OLD.import_batch_id
    THEN RAISE EXCEPTION 'daily_sales.import_batch_id is immutable'; END IF;

  -- 2. Soft-delete fields may only change in soft-delete mode (SECURITY DEFINER
  --    functions set the session local and verify widget; direct updates are blocked).
  v_soft_delete_mode := (
    current_setting('retail_sales.soft_delete_mode', true) = 'true'
    AND current_user <> 'authenticated'
  );

  IF NOT v_soft_delete_mode THEN
    IF NEW.deleted_at     IS DISTINCT FROM OLD.deleted_at     THEN
      RAISE EXCEPTION 'deleted_at may only be set via soft_delete_daily_sale()';
    END IF;
    IF NEW.deleted_by     IS DISTINCT FROM OLD.deleted_by     THEN
      RAISE EXCEPTION 'deleted_by may only be set via soft_delete_daily_sale()';
    END IF;
    IF NEW.delete_reason  IS DISTINCT FROM OLD.delete_reason  THEN
      RAISE EXCEPTION 'delete_reason may only be set via soft_delete_daily_sale()';
    END IF;
  ELSE
    -- In soft-delete mode: can set deleted_* but cannot un-delete.
    IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      RAISE EXCEPTION 'A soft-deleted row cannot be restored (un-deleting is not allowed)';
    END IF;
  END IF;

  -- 3. Block updates when the month is locked (soft-delete path is exempt:
  --    HOD can soft-delete a locked row to correct a data error).
  IF NOT v_soft_delete_mode THEN
    IF public.is_month_locked(OLD.store_id, OLD.sales_date) THEN
      RAISE EXCEPTION 'Month % is locked for store %. Reopen it first or contact HOD.',
        date_trunc('month', OLD.sales_date)::date, OLD.store_id;
    END IF;
  END IF;

  -- 4. Always stamp updated_at / updated_by.
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();

  RETURN NEW;
END;
$$;

CREATE TRIGGER daily_sales_before_update
  BEFORE UPDATE ON public.daily_sales
  FOR EACH ROW EXECUTE FUNCTION public.daily_sales_before_update();

REVOKE ALL ON FUNCTION public.daily_sales_before_update() FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- C. AFTER INSERT/UPDATE audit backstop on daily_sales
--    Writes a daily_sales_audit row for every change that reaches the table.
--    The reason is read from the session local retail_sales.audit_reason (set
--    by the SECURITY DEFINER functions in part 3 before they write).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.daily_sales_audit_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action  text;
  v_reason  text;
  v_old     jsonb;
  v_new     jsonb;
BEGIN
  v_reason := current_setting('retail_sales.audit_reason', true);
  v_new    := to_jsonb(NEW);

  IF TG_OP = 'INSERT' THEN
    IF NEW.source = 'excel_import' THEN
      v_action := 'import';
    ELSE
      v_action := 'insert';
    END IF;
    v_old := NULL;
  ELSE -- UPDATE
    v_old := to_jsonb(OLD);
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
      v_action := 'soft_delete';
    ELSE
      v_action := 'update';
    END IF;
  END IF;

  INSERT INTO public.daily_sales_audit
    (table_name, record_id, store_id, action, old_data, new_data, reason, changed_by)
  VALUES
    ('daily_sales', NEW.id, NEW.store_id, v_action, v_old, v_new, v_reason, auth.uid());

  RETURN NULL; -- AFTER trigger; return value is ignored
END;
$$;

CREATE TRIGGER daily_sales_audit_after
  AFTER INSERT OR UPDATE ON public.daily_sales
  FOR EACH ROW EXECUTE FUNCTION public.daily_sales_audit_trigger();

REVOKE ALL ON FUNCTION public.daily_sales_audit_trigger() FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- D. AFTER INSERT/UPDATE audit backstop on store_opening_balances
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.store_opening_balances_audit_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_reason text;
  v_old    jsonb;
BEGIN
  v_reason := current_setting('retail_sales.audit_reason', true);

  IF TG_OP = 'INSERT' THEN
    v_action := 'set_opening';
    v_old    := NULL;
  ELSE
    v_action := 'edit_opening';
    v_old    := to_jsonb(OLD);
  END IF;

  INSERT INTO public.daily_sales_audit
    (table_name, record_id, store_id, action, old_data, new_data, reason, changed_by)
  VALUES
    ('store_opening_balances', NEW.id, NEW.store_id, v_action, v_old, to_jsonb(NEW), v_reason, auth.uid());

  RETURN NULL;
END;
$$;

CREATE TRIGGER store_opening_balances_audit_after
  AFTER INSERT OR UPDATE ON public.store_opening_balances
  FOR EACH ROW EXECUTE FUNCTION public.store_opening_balances_audit_trigger();

REVOKE ALL ON FUNCTION public.store_opening_balances_audit_trigger() FROM PUBLIC, anon;

-- =============================================================================
-- E. MANUAL TESTS — run in Supabase SQL Editor AFTER parts 1 + 2 are applied.
--
-- Tests 1a–1b: run as the authenticated role (impersonate a store user via
--   "SQL editor → Run as user" or by passing the store user's JWT).
--   Requires: one active store with an opening balance and a store_user row.
--
-- Tests 2–3: run as the service role (default SQL editor context).
--   They simulate what a SECURITY DEFINER function (edit_daily_sale, part 3)
--   would do, to confirm the BEFORE UPDATE trigger fires and rejects the change.
--
-- Replace <STORE_ID> and <ROW_ID> with real values from your test data.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TEST 1a: store user sets import_mode, inserts with source='excel_import'.
--          Expected: trigger overrides → source='manual', status='submitted',
--          import_batch_id=NULL.  The INSERT succeeds (not rejected), but the
--          row is stamped as a normal manual entry, not an import.
-- ---------------------------------------------------------------------------
-- Run as authenticated store user:
DO $$
DECLARE
  v_source  text;
  v_status  text;
  v_batch   uuid;
BEGIN
  -- Attempt to set import_mode as a client (only service role calls check this)
  PERFORM set_config('retail_sales.import_mode', 'true', true);

  INSERT INTO public.daily_sales (
    store_id, sales_date,
    source, status, import_batch_id,
    submitted_by, submitted_at
  ) VALUES (
    '<STORE_ID>'::uuid,
    current_date,
    'excel_import',         -- trigger must override this to 'manual'
    'imported',             -- trigger must override this to 'submitted'
    gen_random_uuid(),      -- trigger must clear this to NULL
    auth.uid(),
    now()
  )
  RETURNING source, status, import_batch_id
    INTO v_source, v_status, v_batch;

  ASSERT v_source = 'manual',    format('FAIL 1a source: expected manual, got %s', v_source);
  ASSERT v_status = 'submitted', format('FAIL 1a status: expected submitted, got %s', v_status);
  ASSERT v_batch  IS NULL,       format('FAIL 1a batch: expected NULL, got %s', v_batch);
  RAISE NOTICE 'PASS 1a: import_mode bypass blocked — source=%, status=%, batch=%',
    v_source, v_status, v_batch;

  -- Clean up
  DELETE FROM public.daily_sales WHERE store_id = '<STORE_ID>'::uuid
    AND sales_date = current_date AND deleted_at IS NULL;
END $$;

-- ---------------------------------------------------------------------------
-- TEST 1b: store user with import_mode NOT set — normal manual insert.
--          Expected: INSERT succeeds, source='manual', status='submitted'.
-- ---------------------------------------------------------------------------
-- (Omitted — covered by 1a; any successful non-import insert is the baseline.)

-- ---------------------------------------------------------------------------
-- TEST 2: direct UPDATE setting deleted_at without soft_delete_mode.
--         Run as service role (which bypasses RLS but hits the trigger).
--         Expected: RAISE EXCEPTION 'deleted_at may only be set via ...'
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- soft_delete_mode is NOT set (empty / missing)
  UPDATE public.daily_sales
     SET deleted_at = now()
   WHERE id = '<ROW_ID>'::uuid;

  RAISE EXCEPTION 'FAIL 2: UPDATE should have been rejected by the trigger';
EXCEPTION
  WHEN OTHERS THEN
    IF sqlerrm LIKE '%deleted_at may only be set%' THEN
      RAISE NOTICE 'PASS 2: deleted_at blocked — %', sqlerrm;
    ELSE
      RAISE;   -- unexpected error, re-raise
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- TEST 3a: UPDATE changing store_id to a different value.
--          Expected: RAISE EXCEPTION 'daily_sales.store_id is immutable'
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_other_store uuid;
BEGIN
  SELECT id INTO v_other_store FROM public.stores
   WHERE id <> '<STORE_ID>'::uuid LIMIT 1;

  UPDATE public.daily_sales
     SET store_id = v_other_store
   WHERE id = '<ROW_ID>'::uuid;

  RAISE EXCEPTION 'FAIL 3a: store_id change should have been rejected';
EXCEPTION
  WHEN OTHERS THEN
    IF sqlerrm LIKE '%store_id is immutable%' THEN
      RAISE NOTICE 'PASS 3a: store_id blocked — %', sqlerrm;
    ELSE
      RAISE;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- TEST 3b: UPDATE changing sales_date.
--          Expected: RAISE EXCEPTION 'daily_sales.sales_date is immutable'
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  UPDATE public.daily_sales
     SET sales_date = sales_date - 1
   WHERE id = '<ROW_ID>'::uuid;

  RAISE EXCEPTION 'FAIL 3b: sales_date change should have been rejected';
EXCEPTION
  WHEN OTHERS THEN
    IF sqlerrm LIKE '%sales_date is immutable%' THEN
      RAISE NOTICE 'PASS 3b: sales_date blocked — %', sqlerrm;
    ELSE
      RAISE;
    END IF;
END $$;

-- END OF PART 2
