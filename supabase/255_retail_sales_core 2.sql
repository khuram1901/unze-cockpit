-- =============================================================================
-- MIGRATION 255 — retail_sales_core
-- Combined from parts 1–4. Apply as ONE transaction only.
-- Parts 1–4 in docs/retail-sales/sql/ are review files; this is the applied file.
-- =============================================================================
BEGIN;

-- =============================================================================
-- MIGRATION 255 — PART 1 of 4
-- Settings, month locking, import batches, opening balances, daily_sales,
-- audit table, RLS. Depends on 254. Final 255 = parts 1-4 in one BEGIN/COMMIT.
-- =============================================================================

-- 1. retail_settings (global key/value)
CREATE TABLE public.retail_settings (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.retail_settings (key, value, description) VALUES
  ('store_backdate_days', '7',            'Store users may submit today or a missing date up to this many days back'),
  ('import_start_date',   '2026-09-01',   'Earliest date accepted by the Excel import'),
  ('import_cutoff_date',  '2026-10-06',   'Latest date accepted by the Excel import'),
  ('lock_day',            '10',           'Month M locks at 23:59:59 local time on this day of month M+1'),
  ('timezone',            'Asia/Karachi', 'Timezone for today, date limits and month locking');

ALTER TABLE public.retail_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY retail_settings_select ON public.retail_settings
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.retail_settings FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.retail_settings FROM authenticated;

-- 2. month_unlocks (HOD reopen; written only by reopen_month() in part 3)
CREATE TABLE public.month_unlocks (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       uuid        REFERENCES public.stores(id) ON DELETE CASCADE,  -- NULL = all stores
  month_start    date        NOT NULL CHECK (extract(day FROM month_start) = 1),
  reason         text        NOT NULL CHECK (length(trim(reason)) > 0),
  unlocked_by    uuid        NOT NULL REFERENCES auth.users(id),
  unlocked_at    timestamptz NOT NULL DEFAULT now(),
  unlocked_until timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoked_by     uuid        REFERENCES auth.users(id),
  CONSTRAINT month_unlocks_expiry_after_start CHECK (unlocked_until > unlocked_at)
);
CREATE INDEX month_unlocks_month_store_idx ON public.month_unlocks (month_start, store_id);

ALTER TABLE public.month_unlocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY month_unlocks_select_widget ON public.month_unlocks
  FOR SELECT TO authenticated USING (public.has_widget('imperial.retail_sales'));
REVOKE ALL ON public.month_unlocks FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.month_unlocks FROM authenticated;

-- 3. is_month_locked(): month M locks at 23:59:59 local on lock_day of M+1,
--    unless an unexpired, unrevoked reopen exists for that store or all stores.
CREATE OR REPLACE FUNCTION public.is_month_locked(p_store_id uuid, p_date date)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month    date := date_trunc('month', p_date)::date;
  v_tz       text;
  v_lock_day int;
  v_lock_at  timestamptz;
BEGIN
  SELECT value      INTO v_tz       FROM public.retail_settings WHERE key = 'timezone';
  SELECT value::int INTO v_lock_day FROM public.retail_settings WHERE key = 'lock_day';
  v_tz       := COALESCE(v_tz, 'Asia/Karachi');
  v_lock_day := COALESCE(v_lock_day, 10);

  -- Local wall-clock time (timestamp without tz), then converted from v_tz.
  -- Sep 2026 -> 2026-10-10 23:59:59 Asia/Karachi = 2026-10-10 18:59:59 UTC
  v_lock_at := ( v_month
                 + interval '1 month'
                 + make_interval(days => v_lock_day - 1)
                 + interval '23 hours 59 minutes 59 seconds'
               )::timestamp AT TIME ZONE v_tz;

  IF now() <= v_lock_at THEN
    RETURN false;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM public.month_unlocks mu
    WHERE (mu.store_id = p_store_id OR mu.store_id IS NULL)
      AND mu.month_start = v_month
      AND mu.revoked_at IS NULL
      AND mu.unlocked_until > now()
  );
END;

$$;
REVOKE ALL ON FUNCTION public.is_month_locked(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_month_locked(uuid, date) TO authenticated;

-- 4. import_batches (one per uploaded file/sheet; written only by import_confirm())
CREATE TABLE public.import_batches (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       uuid        NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  year_month     date        NOT NULL CHECK (extract(day FROM year_month) = 1),
  file_name      text        NOT NULL,
  storage_path   text,        -- original file in the private imports bucket
  row_count      int         NOT NULL DEFAULT 0,
  skipped_count  int         NOT NULL DEFAULT 0,
  replaced_count int         NOT NULL DEFAULT 0,
  replace_reason text,
  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','confirmed','failed')),
  error_detail   jsonb,
  imported_by    uuid        NOT NULL REFERENCES auth.users(id),
  imported_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_batches_replace_needs_reason
    CHECK (replaced_count = 0 OR length(trim(coalesce(replace_reason, ''))) > 0)
);
CREATE INDEX import_batches_store_month_idx ON public.import_batches (store_id, year_month);

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_batches_select_widget ON public.import_batches
  FOR SELECT TO authenticated USING (public.has_widget('imperial.retail_sales'));
REVOKE ALL ON public.import_batches FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.import_batches FROM authenticated;

-- 5. store_opening_balances (one per store; set/edited by Retail Sales widget
--    users via set_opening_balance()/edit_opening_balance() in part 3; edits need a reason)
CREATE TABLE public.store_opening_balances (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     uuid          NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  opening_date date          NOT NULL DEFAULT '2026-09-01',
  amount       numeric(14,2) NOT NULL,   -- zero allowed; negative allowed with UI warning
  source       text          NOT NULL DEFAULT 'manual'
                             CHECK (source IN ('manual','excel_import','csv_import')),
  notes        text,
  set_by       uuid          NOT NULL REFERENCES auth.users(id),
  set_at       timestamptz   NOT NULL DEFAULT now(),
  updated_by   uuid          REFERENCES auth.users(id),
  updated_at   timestamptz,
  CONSTRAINT store_opening_balances_store_unique UNIQUE (store_id)
);

ALTER TABLE public.store_opening_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY sob_select_widget ON public.store_opening_balances
  FOR SELECT TO authenticated USING (public.has_widget('imperial.retail_sales'));
CREATE POLICY sob_select_own ON public.store_opening_balances
  FOR SELECT TO authenticated USING (store_id = public.retail_store_for_user());
REVOKE ALL ON public.store_opening_balances FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.store_opening_balances FROM authenticated;

-- 6. daily_sales (columns = the cash banking Excel sheet)
CREATE TABLE public.daily_sales (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            uuid          NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  sales_date          date          NOT NULL,

  -- Entered values (PKR)
  allied_bank_cc_sale numeric(14,2) NOT NULL DEFAULT 0 CHECK (allied_bank_cc_sale >= 0),
  hbl_cc_sale         numeric(14,2) NOT NULL DEFAULT 0 CHECK (hbl_cc_sale >= 0),
  gift_karte          numeric(14,2) NOT NULL DEFAULT 0 CHECK (gift_karte >= 0),
  credit_notes_issue  numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit_notes_issue >= 0),
  gift_vouchers       numeric(14,2) NOT NULL DEFAULT 0 CHECK (gift_vouchers >= 0),
  cash_sale           numeric(14,2) NOT NULL DEFAULT 0 CHECK (cash_sale >= 0),
  campaign_float_cash numeric(14,2) NOT NULL DEFAULT 0,   -- + cash in / - cash out
  expenses            numeric(14,2) NOT NULL DEFAULT 0 CHECK (expenses >= 0),
  other_income        numeric(14,2) NOT NULL DEFAULT 0 CHECK (other_income >= 0),
  deposit             numeric(14,2) NOT NULL DEFAULT 0 CHECK (deposit >= 0),
  remarks             text,

  -- Calculated by the database (clients cannot set these)
  total_credit_card_sale numeric(14,2) GENERATED ALWAYS AS
    (allied_bank_cc_sale + hbl_cc_sale) STORED,
  total_sale             numeric(14,2) GENERATED ALWAYS AS
    (cash_sale + allied_bank_cc_sale + hbl_cc_sale + gift_karte + gift_vouchers - credit_notes_issue) STORED,
  net_cash_movement      numeric(14,2) GENERATED ALWAYS AS
    (cash_sale + campaign_float_cash + other_income - expenses - deposit) STORED,
  -- opening_balance / closing_balance are calculated in daily_sales_computed (part 3)

  -- Provenance (set by the BEFORE INSERT trigger in part 2; client values ignored)
  status              text          NOT NULL DEFAULT 'submitted'
                      CHECK (status IN ('submitted','imported','edited','reconciled','locked')),
  source              text          NOT NULL DEFAULT 'manual'
                      CHECK (source IN ('manual','excel_import')),
  import_batch_id     uuid          REFERENCES public.import_batches(id) ON DELETE RESTRICT,
  submitted_by        uuid          NOT NULL REFERENCES auth.users(id),
  submitted_at        timestamptz   NOT NULL DEFAULT now(),
  updated_by          uuid          REFERENCES auth.users(id),
  updated_at          timestamptz,

  -- Soft delete (only via soft_delete_daily_sale(), HOD key)
  deleted_at          timestamptz,
  deleted_by          uuid          REFERENCES auth.users(id),
  delete_reason       text,

  -- Future reconciliation (no logic yet)
  bank_reconciled     boolean,
  sap_reconciled      boolean,
  variance            numeric(14,2),

  CONSTRAINT daily_sales_import_consistency
    CHECK ((source = 'excel_import') = (import_batch_id IS NOT NULL)),
  CONSTRAINT daily_sales_soft_delete_consistency CHECK (
    (deleted_at IS NULL AND deleted_by IS NULL AND delete_reason IS NULL)
    OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL
        AND length(trim(coalesce(delete_reason, ''))) > 0)
  )
);

-- One active row per store per date; a soft-deleted day can be re-entered
CREATE UNIQUE INDEX daily_sales_store_date_active_unique
  ON public.daily_sales (store_id, sales_date) WHERE deleted_at IS NULL;
CREATE INDEX daily_sales_import_batch_idx ON public.daily_sales (import_batch_id)
  WHERE import_batch_id IS NOT NULL;

ALTER TABLE public.daily_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY daily_sales_select_widget ON public.daily_sales
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND public.has_widget('imperial.retail_sales'));

CREATE POLICY daily_sales_select_deleted_hod ON public.daily_sales
  FOR SELECT TO authenticated
  USING (deleted_at IS NOT NULL AND public.has_widget('imperial.retail_sales_hod'));

CREATE POLICY daily_sales_select_own ON public.daily_sales
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND store_id = public.retail_store_for_user());

-- Store users insert for their own store only. Date, lock, opening-balance and
-- provenance rules are enforced by the BEFORE INSERT trigger (part 2).
-- No INSERT policy for widget users: imports go only through import_confirm().
CREATE POLICY daily_sales_insert_own ON public.daily_sales
  FOR INSERT TO authenticated
  WITH CHECK (store_id = public.retail_store_for_user());

-- No UPDATE or DELETE policies: edits and soft deletes only via SECURITY DEFINER functions.
REVOKE ALL ON public.daily_sales FROM anon;
REVOKE UPDATE, DELETE ON public.daily_sales FROM authenticated;

-- 7. daily_sales_audit (written only by SECURITY DEFINER functions and the
--    audit backstop trigger in part 2)
CREATE TABLE public.daily_sales_audit (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text        NOT NULL CHECK (table_name IN
               ('daily_sales','store_opening_balances','month_unlocks','import_batches','daily_sales_attachments')),
  record_id  uuid        NOT NULL,
  store_id   uuid        REFERENCES public.stores(id),
  action     text        NOT NULL CHECK (action IN
               ('insert','update','soft_delete','import','replace','reopen','revoke_reopen',
                'set_opening','edit_opening','attach')),
  old_data   jsonb,
  new_data   jsonb,
  reason     text,
  changed_by uuid        REFERENCES auth.users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX daily_sales_audit_record_idx ON public.daily_sales_audit (table_name, record_id);
CREATE INDEX daily_sales_audit_store_time_idx ON public.daily_sales_audit (store_id, changed_at DESC);

ALTER TABLE public.daily_sales_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY daily_sales_audit_select_widget ON public.daily_sales_audit
  FOR SELECT TO authenticated USING (public.has_widget('imperial.retail_sales'));
REVOKE ALL ON public.daily_sales_audit FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.daily_sales_audit FROM authenticated;

-- END OF PART 1

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

-- =============================================================================
-- MIGRATION 255 — PART 3 of 4
-- View (daily_sales_computed), attachments table, SECURITY DEFINER RPCs:
--   reopen_month, revoke_reopen, soft_delete_daily_sale, edit_daily_sale,
--   set_opening_balance, edit_opening_balance.
-- Depends on parts 1 + 2. Final 255 = parts 1–4 in one BEGIN/COMMIT.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. daily_sales_computed VIEW
--    security_invoker = true → underlying daily_sales RLS applies to callers.
--    opening_balance  = store_opening_balances.amount + SUM(net_cash_movement)
--                       for all prior active rows for the same store.
--    closing_balance  = opening_balance + net_cash_movement.
--    Both are NULL (never 0) when no opening balance row exists for the store.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.daily_sales_computed
  WITH (security_invoker = true)
AS
SELECT
  ds.id,
  ds.store_id,
  ds.sales_date,
  ds.allied_bank_cc_sale,
  ds.hbl_cc_sale,
  ds.gift_karte,
  ds.credit_notes_issue,
  ds.gift_vouchers,
  ds.cash_sale,
  ds.campaign_float_cash,
  ds.expenses,
  ds.other_income,
  ds.deposit,
  ds.remarks,
  ds.total_credit_card_sale,
  ds.total_sale,
  ds.net_cash_movement,
  ds.status,
  ds.source,
  ds.import_batch_id,
  ds.submitted_by,
  ds.submitted_at,
  ds.updated_by,
  ds.updated_at,
  ds.deleted_at,
  ds.deleted_by,
  ds.delete_reason,
  ds.bank_reconciled,
  ds.sap_reconciled,
  ds.variance,
  -- opening_balance: NULL when no opening balance row; running sum of prior rows
  CASE
    WHEN sob.store_id IS NULL THEN NULL
    ELSE sob.amount + COALESCE(
      SUM(ds.net_cash_movement) OVER (
        PARTITION BY ds.store_id
        ORDER BY ds.sales_date
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ), 0)
  END AS opening_balance,
  -- closing_balance: opening_balance + this row's net_cash_movement
  CASE
    WHEN sob.store_id IS NULL THEN NULL
    ELSE sob.amount + COALESCE(
      SUM(ds.net_cash_movement) OVER (
        PARTITION BY ds.store_id
        ORDER BY ds.sales_date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ), 0)
  END AS closing_balance
FROM public.daily_sales ds
LEFT JOIN public.store_opening_balances sob ON sob.store_id = ds.store_id
WHERE ds.deleted_at IS NULL;

REVOKE ALL ON public.daily_sales_computed FROM anon;
GRANT SELECT ON public.daily_sales_computed TO authenticated;

-- ---------------------------------------------------------------------------
-- B. daily_sales_attachments
--    FK to daily_sales(id) ON DELETE CASCADE. Max 5 files per row (enforced
--    by trigger). Storage in bucket 'retail-sales'; direct uploads blocked.
-- ---------------------------------------------------------------------------
CREATE TABLE public.daily_sales_attachments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_sale_id uuid       NOT NULL REFERENCES public.daily_sales(id) ON DELETE CASCADE,
  file_name    text        NOT NULL,
  storage_path text        NOT NULL,  -- path inside the 'retail-sales' bucket
  mime_type    text        NOT NULL,
  file_size    int         NOT NULL,
  uploaded_by  uuid        NOT NULL REFERENCES auth.users(id),
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX daily_sales_attachments_sale_idx ON public.daily_sales_attachments (daily_sale_id);

ALTER TABLE public.daily_sales_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY dsa_select_widget ON public.daily_sales_attachments
  FOR SELECT TO authenticated USING (public.has_widget('imperial.retail_sales'));
CREATE POLICY dsa_select_own ON public.daily_sales_attachments
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.daily_sales ds
       WHERE ds.id = daily_sale_id
         AND ds.store_id = public.retail_store_for_user()
         AND ds.deleted_at IS NULL
    )
  );
REVOKE ALL ON public.daily_sales_attachments FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.daily_sales_attachments FROM authenticated;

-- Enforce max 5 attachments per daily_sale row.
CREATE OR REPLACE FUNCTION public.daily_sales_attachments_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM public.daily_sales_attachments
   WHERE daily_sale_id = NEW.daily_sale_id;
  IF v_count >= 5 THEN
    RAISE EXCEPTION 'Maximum 5 attachments per daily sales row (store_id=%, sales_date=%)',
      (SELECT store_id  FROM public.daily_sales WHERE id = NEW.daily_sale_id),
      (SELECT sales_date FROM public.daily_sales WHERE id = NEW.daily_sale_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER daily_sales_attachments_limit
  BEFORE INSERT ON public.daily_sales_attachments
  FOR EACH ROW EXECUTE FUNCTION public.daily_sales_attachments_limit();

REVOKE ALL ON FUNCTION public.daily_sales_attachments_limit() FROM PUBLIC, anon;

-- AFTER INSERT audit on attachments
CREATE OR REPLACE FUNCTION public.daily_sales_attachments_audit_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id uuid;
  v_reason   text;
BEGIN
  SELECT store_id INTO v_store_id FROM public.daily_sales WHERE id = NEW.daily_sale_id;
  v_reason := current_setting('retail_sales.audit_reason', true);

  INSERT INTO public.daily_sales_audit
    (table_name, record_id, store_id, action, old_data, new_data, reason, changed_by)
  VALUES
    ('daily_sales_attachments', NEW.id, v_store_id, 'attach',
     NULL, to_jsonb(NEW), v_reason, auth.uid());

  RETURN NULL;
END;
$$;

CREATE TRIGGER daily_sales_attachments_audit_after
  AFTER INSERT ON public.daily_sales_attachments
  FOR EACH ROW EXECUTE FUNCTION public.daily_sales_attachments_audit_trigger();

REVOKE ALL ON FUNCTION public.daily_sales_attachments_audit_trigger() FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- C. reopen_month(p_store_id, p_month_start, p_until, p_reason)
--    HOD only (imperial.retail_sales_hod). p_store_id NULL = all stores.
--    p_until is mandatory — no indefinite reopens.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reopen_month(
  p_store_id   uuid,
  p_month_start date,
  p_until      timestamptz,
  p_reason     text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unlock_id uuid;
BEGIN
  -- Verify caller has HOD widget.
  IF NOT public.has_widget('imperial.retail_sales_hod') THEN
    RAISE EXCEPTION 'reopen_month requires the imperial.retail_sales_hod widget';
  END IF;

  -- p_month_start must be first of month.
  IF extract(day FROM p_month_start) <> 1 THEN
    RAISE EXCEPTION 'p_month_start must be the first day of a month (got %)', p_month_start;
  END IF;

  -- p_until must be in the future.
  IF p_until <= now() THEN
    RAISE EXCEPTION 'p_until must be in the future (got %)', p_until;
  END IF;

  -- p_reason must not be blank.
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'A reason is required to reopen a month';
  END IF;

  -- Insert the unlock record.
  INSERT INTO public.month_unlocks
    (store_id, month_start, reason, unlocked_by, unlocked_until)
  VALUES
    (p_store_id, p_month_start, p_reason, auth.uid(), p_until)
  RETURNING id INTO v_unlock_id;

  -- Audit row.
  PERFORM set_config('retail_sales.audit_reason', p_reason, true);
  INSERT INTO public.daily_sales_audit
    (table_name, record_id, store_id, action, old_data, new_data, reason, changed_by)
  VALUES
    ('month_unlocks', v_unlock_id, p_store_id, 'reopen',
     NULL,
     jsonb_build_object(
       'month_start', p_month_start,
       'unlocked_until', p_until,
       'store_id', p_store_id
     ),
     p_reason, auth.uid());

  RETURN v_unlock_id;
END;
$$;
REVOKE ALL ON FUNCTION public.reopen_month(uuid, date, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_month(uuid, date, timestamptz, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- D. revoke_reopen(p_unlock_id, p_reason)
--    HOD only. Sets revoked_at; cannot be undone.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_reopen(
  p_unlock_id uuid,
  p_reason    text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unlock public.month_unlocks;
BEGIN
  IF NOT public.has_widget('imperial.retail_sales_hod') THEN
    RAISE EXCEPTION 'revoke_reopen requires the imperial.retail_sales_hod widget';
  END IF;

  SELECT * INTO v_unlock FROM public.month_unlocks WHERE id = p_unlock_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Month unlock % not found', p_unlock_id;
  END IF;
  IF v_unlock.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Month unlock % is already revoked', p_unlock_id;
  END IF;
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'A reason is required to revoke a reopen';
  END IF;

  UPDATE public.month_unlocks
     SET revoked_at = now(), revoked_by = auth.uid()
   WHERE id = p_unlock_id;

  INSERT INTO public.daily_sales_audit
    (table_name, record_id, store_id, action, old_data, new_data, reason, changed_by)
  VALUES
    ('month_unlocks', p_unlock_id, v_unlock.store_id, 'revoke_reopen',
     to_jsonb(v_unlock),
     jsonb_build_object('revoked_at', now(), 'revoked_by', auth.uid()),
     p_reason, auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_reopen(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_reopen(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- E. soft_delete_daily_sale(p_id, p_reason)
--    HOD only. Sets retail_sales.soft_delete_mode = 'true' (transaction-local)
--    so the BEFORE UPDATE trigger allows deleted_* fields to be set.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.soft_delete_daily_sale(
  p_id     uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.daily_sales;
BEGIN
  IF NOT public.has_widget('imperial.retail_sales_hod') THEN
    RAISE EXCEPTION 'soft_delete_daily_sale requires the imperial.retail_sales_hod widget';
  END IF;

  SELECT * INTO v_row FROM public.daily_sales WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'daily_sales row % not found', p_id;
  END IF;
  IF v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'daily_sales row % is already soft-deleted', p_id;
  END IF;
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'A reason is required to soft-delete a daily sales row';
  END IF;

  -- Set session locals consumed by the triggers.
  PERFORM set_config('retail_sales.soft_delete_mode', 'true', true);
  PERFORM set_config('retail_sales.audit_reason', p_reason, true);

  UPDATE public.daily_sales
     SET deleted_at    = now(),
         deleted_by    = auth.uid(),
         delete_reason = p_reason
   WHERE id = p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.soft_delete_daily_sale(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_daily_sale(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- F. edit_daily_sale(p_id, …allowed fields)
--    Widget users only. Cannot change immutable fields (enforced by BEFORE UPDATE
--    trigger). Cannot change deleted_* (also enforced by trigger). Writes audit row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.edit_daily_sale(
  p_id                 uuid,
  p_allied_bank_cc_sale numeric(14,2) DEFAULT NULL,
  p_hbl_cc_sale         numeric(14,2) DEFAULT NULL,
  p_gift_karte          numeric(14,2) DEFAULT NULL,
  p_credit_notes_issue  numeric(14,2) DEFAULT NULL,
  p_gift_vouchers       numeric(14,2) DEFAULT NULL,
  p_cash_sale           numeric(14,2) DEFAULT NULL,
  p_campaign_float_cash numeric(14,2) DEFAULT NULL,
  p_expenses            numeric(14,2) DEFAULT NULL,
  p_other_income        numeric(14,2) DEFAULT NULL,
  p_deposit             numeric(14,2) DEFAULT NULL,
  p_remarks             text          DEFAULT NULL,
  p_reason              text          DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.daily_sales;
BEGIN
  IF NOT public.has_widget('imperial.retail_sales') THEN
    RAISE EXCEPTION 'edit_daily_sale requires the imperial.retail_sales widget';
  END IF;

  IF length(trim(coalesce(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'A reason is required when editing a daily sales row';
  END IF;

  SELECT * INTO v_row FROM public.daily_sales WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'daily_sales row % not found', p_id;
  END IF;
  IF v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot edit a soft-deleted daily sales row (id=%)', p_id;
  END IF;

  PERFORM set_config('retail_sales.audit_reason', p_reason, true);

  UPDATE public.daily_sales SET
    allied_bank_cc_sale  = COALESCE(p_allied_bank_cc_sale,  allied_bank_cc_sale),
    hbl_cc_sale          = COALESCE(p_hbl_cc_sale,          hbl_cc_sale),
    gift_karte           = COALESCE(p_gift_karte,           gift_karte),
    credit_notes_issue   = COALESCE(p_credit_notes_issue,   credit_notes_issue),
    gift_vouchers        = COALESCE(p_gift_vouchers,        gift_vouchers),
    cash_sale            = COALESCE(p_cash_sale,            cash_sale),
    campaign_float_cash  = COALESCE(p_campaign_float_cash,  campaign_float_cash),
    expenses             = COALESCE(p_expenses,             expenses),
    other_income         = COALESCE(p_other_income,         other_income),
    deposit              = COALESCE(p_deposit,              deposit),
    remarks              = COALESCE(p_remarks,              remarks),
    status               = CASE WHEN status = 'submitted' THEN 'edited' ELSE status END
  WHERE id = p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.edit_daily_sale(uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_daily_sale(uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- G. set_opening_balance(p_store_id, p_amount, p_opening_date, p_notes)
--    Widget users only. Inserts a new opening balance row (one per store).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_opening_balance(
  p_store_id    uuid,
  p_amount      numeric(14,2),
  p_opening_date date DEFAULT '2026-09-01',
  p_notes       text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_widget('imperial.retail_sales') THEN
    RAISE EXCEPTION 'set_opening_balance requires the imperial.retail_sales widget';
  END IF;

  PERFORM set_config('retail_sales.audit_reason', 'Initial opening balance set', true);

  INSERT INTO public.store_opening_balances
    (store_id, opening_date, amount, source, notes, set_by)
  VALUES
    (p_store_id, p_opening_date, p_amount, 'manual', p_notes, auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.set_opening_balance(uuid, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_opening_balance(uuid, numeric, date, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- H. edit_opening_balance(p_store_id, p_amount, p_opening_date, p_reason, p_notes)
--    Widget users only. Reason required.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.edit_opening_balance(
  p_store_id     uuid,
  p_amount       numeric(14,2),
  p_opening_date date,
  p_reason       text,
  p_notes        text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_widget('imperial.retail_sales') THEN
    RAISE EXCEPTION 'edit_opening_balance requires the imperial.retail_sales widget';
  END IF;

  IF length(trim(coalesce(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'A reason is required to edit an opening balance';
  END IF;

  PERFORM set_config('retail_sales.audit_reason', p_reason, true);

  UPDATE public.store_opening_balances
     SET amount       = p_amount,
         opening_date = p_opening_date,
         notes        = p_notes,
         updated_by   = auth.uid(),
         updated_at   = now()
   WHERE store_id = p_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No opening balance found for store %. Use set_opening_balance() first.', p_store_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.edit_opening_balance(uuid, numeric, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_opening_balance(uuid, numeric, date, text, text) TO authenticated;

-- END OF PART 3

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

COMMIT;
