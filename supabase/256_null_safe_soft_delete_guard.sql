-- =============================================================================
-- MIGRATION 256 — null_safe_soft_delete_guard
-- Fixes a NULL-propagation bug in daily_sales_before_update().
--
-- ROOT CAUSE:
--   current_setting('retail_sales.soft_delete_mode', true) returns NULL when
--   the GUC has not been set in the current session (the second arg = true means
--   "return NULL instead of raising an error on missing key").
--   NULL = 'true'  →  NULL  (not FALSE)
--   NULL AND ...   →  NULL  (not FALSE)
--   PL/pgSQL: IF NULL THEN ...  →  branch not taken (silent pass-through)
--   Result: the soft-delete guard silently did nothing; the check constraint on
--   daily_sales fired instead, producing a confusing error.
--
-- FIX:
--   Wrap the entire boolean expression in COALESCE(..., false) so an unset GUC
--   produces FALSE (soft-delete mode OFF) rather than NULL (undefined).
--
-- APPLIED: 2026-10-07
-- Supabase project: ffwdubfkcaoiyohscael (ap-southeast-1)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.daily_sales_before_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'public' AS $$
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

  -- 2. Soft-delete fields may only change in soft-delete mode.
  --    COALESCE(..., false): if the GUC is not set, current_setting returns NULL,
  --    and NULL propagates through boolean AND — COALESCE ensures we get FALSE
  --    (mode OFF) rather than NULL (undefined / silently skipped guard).
  v_soft_delete_mode := COALESCE(
    current_setting('retail_sales.soft_delete_mode', true) = 'true'
    AND current_user <> 'authenticated',
    false
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
    -- In soft-delete mode: allow setting deleted_at/by/reason, but un-deleting
    -- (clearing deleted_at) is never permitted.
    IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      RAISE EXCEPTION 'A soft-deleted row cannot be restored (un-deleting is not allowed)';
    END IF;
  END IF;

  -- 3. Month-lock check (skip in soft-delete mode — HOD must be able to delete
  --    rows in a locked month via soft_delete_daily_sale()).
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
