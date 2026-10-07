-- =============================================================================
-- MIGRATION 255 — PART 4 of 4
-- Storage buckets, import_preview(), import_confirm().
-- Depends on parts 1–3. Final 255 = parts 1–4 in one BEGIN/COMMIT.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Storage buckets
--    retail-sales: attachments (private, signed URLs only, 10 MB max)
--    retail-sales-imports: raw uploaded Excel/CSV files (private)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('retail-sales', 'retail-sales', false, 10485760,
   ARRAY['image/jpeg','image/png','image/webp','application/pdf']),
  ('retail-sales-imports', 'retail-sales-imports', false, 52428800,
   ARRAY['application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'text/csv',
         'application/octet-stream'])
ON CONFLICT (id) DO NOTHING;

-- RLS on storage.objects — retail-sales bucket (attachments)
-- Authenticated widget users can read files for stores they have access to.
-- Direct INSERT is blocked; uploads go via signed upload URLs from SECURITY DEFINER.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename  = 'objects'
       AND policyname = 'retail_sales_attachments_read'
  ) THEN
    CREATE POLICY retail_sales_attachments_read ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'retail-sales'
        AND (
          -- Widget users see all attachment files for the module
          public.has_widget('imperial.retail_sales')
          -- Store users see only their own store's files
          OR (name LIKE (public.retail_store_for_user()::text || '/%'))
        )
      );
  END IF;
END;
$$;

-- RLS on storage.objects — retail-sales-imports bucket
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename  = 'objects'
       AND policyname = 'retail_sales_imports_read'
  ) THEN
    CREATE POLICY retail_sales_imports_read ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'retail-sales-imports'
        AND public.has_widget('imperial.retail_sales')
      );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- B. import_preview(p_store_id, p_rows)
--    Validates a batch of rows from the Excel import, returns per-row status.
--    NO WRITES. Returns jsonb: { valid: [...], errors: [...], warnings: [...] }
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_preview(
  p_store_id uuid,
  p_rows     jsonb   -- array of row objects with keys matching daily_sales columns
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_import_start  date;
  v_import_cutoff date;
  v_tz            text;
  v_row           jsonb;
  v_date          date;
  v_valid         jsonb[] := '{}';
  v_errors        jsonb[] := '{}';
  v_warnings      jsonb[] := '{}';
  v_existing      boolean;
  v_locked        boolean;
  v_ob_date       date;
  v_store_active  boolean;
  v_store_name    text;
  i               int := 0;
BEGIN
  IF NOT public.has_widget('imperial.retail_sales') THEN
    RAISE EXCEPTION 'import_preview requires the imperial.retail_sales widget';
  END IF;

  -- Load settings
  SELECT value::date INTO v_import_start  FROM public.retail_settings WHERE key = 'import_start_date';
  SELECT value::date INTO v_import_cutoff FROM public.retail_settings WHERE key = 'import_cutoff_date';
  SELECT value       INTO v_tz            FROM public.retail_settings WHERE key = 'timezone';
  v_tz := COALESCE(v_tz, 'Asia/Karachi');

  -- Check store
  SELECT is_active, name INTO v_store_active, v_store_name
    FROM public.stores WHERE id = p_store_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store % not found', p_store_id;
  END IF;
  IF NOT v_store_active THEN
    RAISE EXCEPTION 'Store % (%s) is not active', p_store_id, v_store_name;
  END IF;

  -- Check opening balance exists
  SELECT opening_date INTO v_ob_date
    FROM public.store_opening_balances WHERE store_id = p_store_id;

  -- Validate each row
  FOR v_row IN SELECT jsonb_array_elements(p_rows)
  LOOP
    i := i + 1;

    -- Parse date
    BEGIN
      v_date := (v_row->>'sales_date')::date;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'row', i, 'sales_date', v_row->>'sales_date',
        'error', 'Invalid date format (expected YYYY-MM-DD)');
      CONTINUE;
    END;

    -- Date range check
    IF v_date < v_import_start THEN
      v_errors := v_errors || jsonb_build_object(
        'row', i, 'sales_date', v_date,
        'error', format('Date %s is before import_start_date %s', v_date, v_import_start));
      CONTINUE;
    END IF;
    IF v_date > v_import_cutoff THEN
      v_errors := v_errors || jsonb_build_object(
        'row', i, 'sales_date', v_date,
        'error', format('Date %s is after import_cutoff_date %s', v_date, v_import_cutoff));
      CONTINUE;
    END IF;

    -- Opening balance check
    IF v_ob_date IS NULL THEN
      v_errors := v_errors || jsonb_build_object(
        'row', i, 'sales_date', v_date,
        'error', 'No opening balance set for this store');
      CONTINUE;
    END IF;
    IF v_date < v_ob_date THEN
      v_errors := v_errors || jsonb_build_object(
        'row', i, 'sales_date', v_date,
        'error', format('Date %s is before opening_date %s', v_date, v_ob_date));
      CONTINUE;
    END IF;

    -- Lock check
    v_locked := public.is_month_locked(p_store_id, v_date);
    IF v_locked THEN
      v_errors := v_errors || jsonb_build_object(
        'row', i, 'sales_date', v_date,
        'error', format('Month %s is locked', date_trunc('month', v_date)::date));
      CONTINUE;
    END IF;

    -- Check for existing active row (will be replaced)
    SELECT EXISTS (
      SELECT 1 FROM public.daily_sales
       WHERE store_id = p_store_id AND sales_date = v_date AND deleted_at IS NULL
    ) INTO v_existing;

    IF v_existing THEN
      v_warnings := v_warnings || jsonb_build_object(
        'row', i, 'sales_date', v_date,
        'warning', 'Existing active row will be soft-deleted and replaced');
    END IF;

    v_valid := v_valid || jsonb_build_object(
      'row', i, 'sales_date', v_date, 'will_replace', v_existing);
  END LOOP;

  RETURN jsonb_build_object(
    'store_id',   p_store_id,
    'store_name', v_store_name,
    'row_count',  jsonb_array_length(p_rows),
    'valid',      to_jsonb(v_valid),
    'errors',     to_jsonb(v_errors),
    'warnings',   to_jsonb(v_warnings)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.import_preview(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_preview(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- C. import_confirm(p_store_id, p_batch_id, p_rows)
--    Writes import_batches row, soft-deletes any existing active rows for the
--    same dates, then inserts new rows with source='excel_import'.
--    SET LOCAL retail_sales.import_mode = 'true' so the BEFORE INSERT trigger
--    takes the import path. Guard: current_user must not be 'authenticated'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_confirm(
  p_store_id  uuid,
  p_batch_id  uuid,        -- import_batches.id (caller creates and passes)
  p_rows      jsonb,       -- array of row objects; same shape as import_preview
  p_reason    text DEFAULT NULL  -- optional replace_reason if any row replaces existing
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row           jsonb;
  v_date          date;
  v_inserted      int := 0;
  v_replaced      int := 0;
  v_existing_id   uuid;
  v_store_active  boolean;
  v_store_name    text;
BEGIN
  -- Double guard: this function is SECURITY DEFINER, so current_user is the
  -- function owner — never 'authenticated'. The check below is belt-and-braces.
  IF current_user = 'authenticated' THEN
    RAISE EXCEPTION 'import_confirm must not be called directly by authenticated users';
  END IF;

  IF NOT public.has_widget('imperial.retail_sales') THEN
    RAISE EXCEPTION 'import_confirm requires the imperial.retail_sales widget';
  END IF;

  SELECT is_active, name INTO v_store_active, v_store_name
    FROM public.stores WHERE id = p_store_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store % not found', p_store_id;
  END IF;
  IF NOT v_store_active THEN
    RAISE EXCEPTION 'Store % (%s) is not active', p_store_id, v_store_name;
  END IF;

  -- Activate import mode for this transaction only.
  SET LOCAL "retail_sales.import_mode" = 'true';

  -- Process each row.
  FOR v_row IN SELECT jsonb_array_elements(p_rows)
  LOOP
    v_date := (v_row->>'sales_date')::date;

    -- Soft-delete any existing active row for this date.
    SELECT id INTO v_existing_id
      FROM public.daily_sales
     WHERE store_id = p_store_id AND sales_date = v_date AND deleted_at IS NULL;

    IF FOUND THEN
      PERFORM set_config('retail_sales.soft_delete_mode', 'true', true);
      PERFORM set_config('retail_sales.audit_reason',
        format('Replaced by import batch %s: %s', p_batch_id, COALESCE(p_reason, 'no reason given')), true);
      UPDATE public.daily_sales
         SET deleted_at    = now(),
             deleted_by    = auth.uid(),
             delete_reason = format('Replaced by import batch %s', p_batch_id)
       WHERE id = v_existing_id;
      PERFORM set_config('retail_sales.soft_delete_mode', 'false', true);
      v_replaced := v_replaced + 1;
    END IF;

    -- Set audit reason for the import insert.
    PERFORM set_config('retail_sales.audit_reason',
      format('Imported via batch %s', p_batch_id), true);

    -- Insert the imported row. The BEFORE INSERT trigger validates dates/lock/ob.
    INSERT INTO public.daily_sales (
      store_id, sales_date, import_batch_id,
      source, status,
      allied_bank_cc_sale, hbl_cc_sale, gift_karte, credit_notes_issue,
      gift_vouchers, cash_sale, campaign_float_cash, expenses, other_income,
      deposit, remarks,
      submitted_by, submitted_at
    ) VALUES (
      p_store_id,
      v_date,
      p_batch_id,
      'excel_import',
      'imported',
      COALESCE((v_row->>'allied_bank_cc_sale')::numeric, 0),
      COALESCE((v_row->>'hbl_cc_sale')::numeric, 0),
      COALESCE((v_row->>'gift_karte')::numeric, 0),
      COALESCE((v_row->>'credit_notes_issue')::numeric, 0),
      COALESCE((v_row->>'gift_vouchers')::numeric, 0),
      COALESCE((v_row->>'cash_sale')::numeric, 0),
      COALESCE((v_row->>'campaign_float_cash')::numeric, 0),
      COALESCE((v_row->>'expenses')::numeric, 0),
      COALESCE((v_row->>'other_income')::numeric, 0),
      COALESCE((v_row->>'deposit')::numeric, 0),
      v_row->>'remarks',
      auth.uid(), now()
    );

    v_inserted := v_inserted + 1;
  END LOOP;

  -- Update the import_batches row with final counts.
  UPDATE public.import_batches
     SET status         = 'confirmed',
         row_count      = v_inserted,
         replaced_count = v_replaced,
         replace_reason = p_reason
   WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'replaced', v_replaced,
    'batch_id', p_batch_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.import_confirm(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_confirm(uuid, uuid, jsonb, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- D. End-of-migration assertions
--    Run after all 4 parts are applied in the combined 255 file.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_table_count    int;
  v_settings_count int;
  v_audit_writable boolean;
  v_locked_result  boolean;
BEGIN
  -- 1. All 7 core tables exist.
  SELECT COUNT(*) INTO v_table_count
    FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name IN (
       'retail_settings', 'month_unlocks', 'import_batches',
       'store_opening_balances', 'daily_sales', 'daily_sales_audit',
       'daily_sales_attachments'
     );
  ASSERT v_table_count = 7,
    format('Expected 7 core tables, found %s', v_table_count);

  -- 2. retail_settings has exactly 5 rows.
  SELECT COUNT(*) INTO v_settings_count FROM public.retail_settings;
  ASSERT v_settings_count = 5,
    format('Expected 5 retail_settings rows, found %s', v_settings_count);

  -- 3. is_month_locked() is callable (returns false for a future month).
  SELECT public.is_month_locked(
    (SELECT id FROM public.stores LIMIT 1),
    '2099-01-01'
  ) INTO v_locked_result;
  ASSERT v_locked_result = false,
    'is_month_locked() returned unexpected result for future month';

  -- 4. daily_sales_audit is not directly writable by authenticated role.
  --    (Checked via privilege: INSERT should NOT be in table_privileges for authenticated.)
  SELECT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND table_name   = 'daily_sales_audit'
       AND grantee      = 'authenticated'
       AND privilege_type = 'INSERT'
  ) INTO v_audit_writable;
  ASSERT v_audit_writable = false,
    'daily_sales_audit should not have INSERT granted to authenticated';

  RAISE NOTICE '255 assertions: 7 tables ✓, 5 settings ✓, is_month_locked ✓, audit write-blocked ✓';
END;
$$;

-- END OF PART 4
