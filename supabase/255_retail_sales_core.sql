-- =============================================================================
-- MIGRATION 255: Retail Sales Core — PART 1 of 4
-- Project: ffwdubfkcaoiyohscael (Unze Dashboard)
-- Apply manually via Supabase SQL Editor. DO NOT auto-run.
-- Depends on: Migration 254 (stores, store_users, has_widget, retail_store_for_user)
--
-- Part 1 (this file): retail_settings, month_unlocks, is_month_locked(),
--                     import_batches, store_opening_balances, daily_sales + RLS
-- Part 2: daily_sales triggers (BEFORE INSERT, BEFORE UPDATE)
-- Part 3: daily_sales_computed VIEW, daily_sales_attachments, SECURITY DEFINER RPCs
-- Part 4: storage buckets, import_preview(), import_confirm(), final assertions
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. retail_settings — one row per store for global store configuration
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.retail_settings (
    store_id    uuid PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
    timezone    text NOT NULL DEFAULT 'Asia/Karachi',
    lock_day    int  NOT NULL DEFAULT 10,   -- day of following month when sales auto-lock
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.retail_settings IS
    'One row per store. lock_day: sales for month M auto-lock at 23:59:59 PKT on '
    'day lock_day of month M+1. Default 10 means the 10th of the following month.';

ALTER TABLE public.retail_settings ENABLE ROW LEVEL SECURITY;

-- Widget holders (Finance Managers, HOD) can read all store settings
CREATE POLICY "retail_settings_widget_select"
    ON public.retail_settings FOR SELECT TO authenticated
    USING ( public.has_widget('imperial.retail_sales') );

-- Store users can read their own store settings
CREATE POLICY "retail_settings_storeuser_select"
    ON public.retail_settings FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.store_users su
            WHERE su.store_id = retail_settings.store_id
              AND su.user_id  = auth.uid()
        )
    );

-- No direct INSERT/UPDATE/DELETE for authenticated — managed via service_role only
REVOKE INSERT, UPDATE, DELETE ON public.retail_settings FROM authenticated;

CREATE POLICY "retail_settings_service_role_all"
    ON public.retail_settings FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 2. month_unlocks — records HOD-approved reopenings of auto-locked months
--    Default state: no row = month is locked if past auto-lock time
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.month_unlocks (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id     uuid        NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    month_start  date        NOT NULL,     -- always the first day of the month
    unlocked_by  uuid        NOT NULL REFERENCES auth.users(id),
    unlocked_at  timestamptz NOT NULL DEFAULT now(),
    reason       text,
    relocked_at  timestamptz,              -- NULL = still open; set by reopen_month(relock:=true)
    UNIQUE (store_id, month_start)
);

COMMENT ON TABLE public.month_unlocks IS
    'One row per store+month that has been explicitly reopened. '
    'relocked_at IS NULL means the month is currently unlocked. '
    'Absence of a row does NOT mean unlocked — see is_month_locked().';

ALTER TABLE public.month_unlocks ENABLE ROW LEVEL SECURITY;

-- Widget holders can see unlock history (for audit UI)
CREATE POLICY "month_unlocks_widget_select"
    ON public.month_unlocks FOR SELECT TO authenticated
    USING ( public.has_widget('imperial.retail_sales') );

-- No direct INSERT/UPDATE for authenticated — must use reopen_month() RPC
REVOKE INSERT, UPDATE, DELETE ON public.month_unlocks FROM authenticated;

CREATE POLICY "month_unlocks_service_role_all"
    ON public.month_unlocks FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 3. is_month_locked(p_store_id, p_date) — called by BEFORE INSERT trigger
--    and by the UI to show lock status.
--
--    Logic:
--      - Auto-lock fires at 23:59:59 store-local time on lock_day of month+1
--      - Before that moment: NOT locked (return false)
--      - After that moment: locked UNLESS a month_unlocks row exists with
--        relocked_at IS NULL (i.e. an active HOD reopen)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_month_locked(
    p_store_id  uuid,
    p_date      date
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_month_start     date;
    v_lock_day        int;
    v_auto_lock_after timestamptz;
    v_tz              text;
    v_unlock_record   record;
BEGIN
    -- First day of the month containing p_date
    v_month_start := date_trunc('month', p_date)::date;

    -- Get store timezone and lock_day; fall back to defaults if no row
    SELECT timezone, lock_day
      INTO v_tz, v_lock_day
      FROM public.retail_settings
     WHERE store_id = p_store_id;

    IF NOT FOUND THEN
        v_tz       := 'Asia/Karachi';
        v_lock_day := 10;
    END IF;

    -- Auto-lock timestamp: midnight of lock_day in the FOLLOWING month, store TZ
    -- e.g. lock_day=10, month=Sep → 2026-10-10 23:59:59 PKT expressed as UTC
    v_auto_lock_after := (
        (date_trunc('month', p_date) + interval '1 month')
        + (v_lock_day - 1) * interval '1 day'
        + interval '23 hours 59 minutes 59 seconds'
    ) AT TIME ZONE v_tz AT TIME ZONE 'UTC';

    -- Before auto-lock: not yet locked
    IF now() <= v_auto_lock_after THEN
        RETURN false;
    END IF;

    -- Past auto-lock: locked unless an active HOD reopen exists
    SELECT * INTO v_unlock_record
      FROM public.month_unlocks
     WHERE store_id   = p_store_id
       AND month_start = v_month_start
       AND relocked_at IS NULL
     LIMIT 1;

    RETURN NOT FOUND OR v_unlock_record.id IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.is_month_locked(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_month_locked(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. import_batches — one row per Excel/CSV import run; referenced by daily_sales
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_batches (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id     uuid        NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    imported_by  uuid        NOT NULL REFERENCES auth.users(id),
    imported_at  timestamptz NOT NULL DEFAULT now(),
    filename     text,
    row_count    int,
    status       text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','success','partial','failed')),
    error_detail text
);

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

-- Widget holders can see import history
CREATE POLICY "import_batches_widget_select"
    ON public.import_batches FOR SELECT TO authenticated
    USING ( public.has_widget('imperial.retail_sales') );

-- No direct INSERT for authenticated — created inside import_confirm() SECURITY DEFINER
REVOKE INSERT, UPDATE, DELETE ON public.import_batches FROM authenticated;

CREATE POLICY "import_batches_service_role_all"
    ON public.import_batches FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 5. store_opening_balances — one row per store; required before any sales entry
--    opening_balance = NULL when this row is absent (never default to 0)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.store_opening_balances (
    store_id   uuid          PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
    amount     numeric(14,2) NOT NULL,
    as_of_date date          NOT NULL,   -- the date the balance applies from
    set_by     uuid          NOT NULL REFERENCES auth.users(id),
    set_at     timestamptz   NOT NULL DEFAULT now(),
    updated_by uuid          REFERENCES auth.users(id),
    updated_at timestamptz,
    notes      text
);

COMMENT ON TABLE public.store_opening_balances IS
    'One row per store. Opening balance used in closing_balance computation. '
    'If absent, opening_balance in daily_sales_computed view is NULL — never 0. '
    'Set and edited only by HOD via set_opening_balance() / edit_opening_balance() RPCs.';

ALTER TABLE public.store_opening_balances ENABLE ROW LEVEL SECURITY;

-- Widget holders can read all opening balances
CREATE POLICY "sob_widget_select"
    ON public.store_opening_balances FOR SELECT TO authenticated
    USING ( public.has_widget('imperial.retail_sales') );

-- Store users can read their own store's opening balance
CREATE POLICY "sob_storeuser_select"
    ON public.store_opening_balances FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.store_users su
            WHERE su.store_id = store_opening_balances.store_id
              AND su.user_id  = auth.uid()
        )
    );

-- No direct writes for authenticated — use set_opening_balance() / edit_opening_balance()
REVOKE INSERT, UPDATE, DELETE ON public.store_opening_balances FROM authenticated;

CREATE POLICY "sob_service_role_all"
    ON public.store_opening_balances FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 6. daily_sales — core fact table; one row per store per date (non-deleted)
--
--    Key rules (enforced in triggers, NOT just UI):
--      - Exactly one active (deleted_at IS NULL) row per store+date
--      - sales_date must be >= store.manual_entry_start_date
--      - sales_date must not be in the future
--      - Month must not be locked (is_month_locked())
--      - Opening balance must exist before any INSERT
--      - Provenance fields (submitted_by, submitted_at, source) are immutable after insert
--      - closing_balance computed in daily_sales_computed VIEW — never stored here
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_sales (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),

    store_id        uuid          NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
    sales_date      date          NOT NULL,

    -- Sales figures (all client-supplied; validated by BEFORE INSERT trigger)
    gross_sales     numeric(14,2) NOT NULL CHECK (gross_sales >= 0),
    returns         numeric(14,2) NOT NULL DEFAULT 0 CHECK (returns >= 0),
    net_sales       numeric(14,2) GENERATED ALWAYS AS (gross_sales - returns) STORED,

    discounts       numeric(14,2) NOT NULL DEFAULT 0 CHECK (discounts >= 0),
    cash_sales      numeric(14,2) NOT NULL DEFAULT 0 CHECK (cash_sales >= 0),
    card_sales      numeric(14,2) NOT NULL DEFAULT 0 CHECK (card_sales >= 0),
    online_sales    numeric(14,2) NOT NULL DEFAULT 0 CHECK (online_sales >= 0),

    expenses        numeric(14,2) NOT NULL DEFAULT 0 CHECK (expenses >= 0),
    expense_detail  text,

    notes           text,

    -- Provenance (overwritten by BEFORE INSERT trigger — never trust client values)
    submitted_by    uuid          NOT NULL REFERENCES auth.users(id),
    submitted_at    timestamptz   NOT NULL DEFAULT now(),
    source          text          NOT NULL DEFAULT 'manual'
                                    CHECK (source IN ('manual', 'excel_import')),
    import_batch_id uuid          REFERENCES public.import_batches(id),
    status          text          NOT NULL DEFAULT 'submitted'
                                    CHECK (status IN ('submitted', 'approved', 'rejected')),

    -- Soft-delete fields (set only via soft_delete_daily_sale() SECURITY DEFINER)
    deleted_at      timestamptz,
    deleted_by      uuid          REFERENCES auth.users(id),
    delete_reason   text,

    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now()
);

-- Partial unique index: exactly one active (non-deleted) row per store per date
-- Soft-deleted rows are excluded so a date can be re-entered after deletion.
CREATE UNIQUE INDEX IF NOT EXISTS daily_sales_store_date_active_unique
    ON public.daily_sales (store_id, sales_date)
    WHERE deleted_at IS NULL;

-- Support efficient lookups by store+date range
CREATE INDEX IF NOT EXISTS daily_sales_store_date_idx
    ON public.daily_sales (store_id, sales_date DESC)
    WHERE deleted_at IS NULL;

ALTER TABLE public.daily_sales ENABLE ROW LEVEL SECURITY;

-- Widget holders (Finance Managers, HOD): read non-deleted rows across all stores
CREATE POLICY "daily_sales_widget_select"
    ON public.daily_sales FOR SELECT TO authenticated
    USING (
        deleted_at IS NULL
        AND public.has_widget('imperial.retail_sales')
    );

-- Store users: read their own store's non-deleted rows only
CREATE POLICY "daily_sales_storeuser_select"
    ON public.daily_sales FOR SELECT TO authenticated
    USING (
        deleted_at IS NULL
        AND store_id = public.retail_store_for_user()
    );

-- INSERT: store users only; trigger enforces all validation
CREATE POLICY "daily_sales_storeuser_insert"
    ON public.daily_sales FOR INSERT TO authenticated
    WITH CHECK (
        store_id = public.retail_store_for_user()
    );

-- UPDATE: blocked for direct use — only SECURITY DEFINER functions may update
-- (edit_daily_sale, soft_delete_daily_sale, import_confirm set a session local first)
CREATE POLICY "daily_sales_no_direct_update"
    ON public.daily_sales FOR UPDATE TO authenticated
    USING (false);

-- DELETE: never allowed for authenticated — soft delete only
CREATE POLICY "daily_sales_no_delete"
    ON public.daily_sales FOR DELETE TO authenticated
    USING (false);

-- service_role: unrestricted (used by server-side scripts and admin tools)
CREATE POLICY "daily_sales_service_role_all"
    ON public.daily_sales FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- =============================================================================
-- END OF PART 1
-- Part 2 continues with:
--   §7  daily_sales_before_insert() trigger
--   §8  daily_sales_before_update() trigger
-- =============================================================================
