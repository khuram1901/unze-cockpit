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
