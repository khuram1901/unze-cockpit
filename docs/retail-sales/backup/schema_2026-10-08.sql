-- ============================================================
-- Retail Sales schema backup — 2026-10-08
-- Supabase project: ffwdubfkcaoiyohscael (ap-southeast-1)
-- Branch: feature/retail-sales  commit: 9d85013
-- Migrations applied: 254, 255, 256, 257, 260
-- NO DATA — schema only. No secrets.
-- ============================================================

-- ============================================================
-- SOURCE: supabase/254_retail_stores.sql
-- ============================================================

-- Table: stores
CREATE TABLE IF NOT EXISTS public.stores (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fm_code text NOT NULL CHECK (fm_code ~ '^[0-9]{3}$'),
    name text NOT NULL,
    email text NOT NULL CHECK (email = lower(email)),
    manual_entry_start_date date NOT NULL DEFAULT '2026-10-07',
    admin_location_id uuid REFERENCES admin_locations(id) ON DELETE SET NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT stores_fm_code_unique UNIQUE (fm_code)
);

CREATE UNIQUE INDEX IF NOT EXISTS stores_email_lower_unique ON public.stores (lower(email));

-- Table: store_users
CREATE TABLE IF NOT EXISTS public.store_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    is_primary boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT store_users_user_store_unique UNIQUE (user_id, store_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS store_users_one_primary ON public.store_users (user_id) WHERE is_primary;

-- Function: has_widget()
CREATE OR REPLACE FUNCTION public.has_widget(p_widget_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.member_widget_overrides mwo
        JOIN public.members m ON m.id = mwo.member_id
        WHERE m.user_id = auth.uid()
          AND mwo.widget_key = p_widget_key
          AND mwo.visible = true
    )
$$;
REVOKE ALL ON FUNCTION public.has_widget(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_widget(text) TO authenticated;

-- Function: retail_store_for_user()
CREATE OR REPLACE FUNCTION public.retail_store_for_user()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT s.id
    FROM public.store_users su
    JOIN public.stores s ON s.id = su.store_id
    WHERE su.user_id = auth.uid()
      AND su.is_primary = true
      AND s.is_active = true
      AND lower(s.email) = lower(auth.email())
    LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.retail_store_for_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retail_store_for_user() TO authenticated;

-- RLS: stores
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY stores_select_own ON public.stores
    FOR SELECT TO authenticated
    USING (lower(email) = lower(auth.email()));

CREATE POLICY stores_select_widget ON public.stores
    FOR SELECT TO authenticated
    USING (has_widget('imperial.retail_sales') OR has_widget('imperial.retail_sales_hod'));

CREATE POLICY stores_service ON public.stores
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

REVOKE INSERT, UPDATE, DELETE ON public.stores FROM anon, authenticated;

-- RLS: store_users
ALTER TABLE public.store_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY store_users_select_own ON public.store_users
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY store_users_select_widget ON public.store_users
    FOR SELECT TO authenticated
    USING (has_widget('imperial.retail_sales') OR has_widget('imperial.retail_sales_hod'));

CREATE POLICY store_users_service ON public.store_users
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

REVOKE INSERT, UPDATE, DELETE ON public.store_users FROM anon, authenticated;

-- ============================================================
-- SOURCE: supabase/255_retail_sales_core.sql
-- ============================================================

-- Table: retail_settings
CREATE TABLE IF NOT EXISTS public.retail_settings (
    key text PRIMARY KEY,
    value text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.retail_settings (key, value) VALUES
    ('store_backdate_days', '7'),
    ('import_start_date', '2026-09-01'),
    ('import_cutoff_date', '2026-10-06'),
    ('lock_day', '10'),
    ('timezone', 'Asia/Karachi')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.retail_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY retail_settings_select ON public.retail_settings
    FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.retail_settings FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.retail_settings FROM authenticated;

-- Table: month_unlocks
CREATE TABLE IF NOT EXISTS public.month_unlocks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE, -- NULL = all stores
    month_start date NOT NULL CHECK (extract(day FROM month_start) = 1),
    reason text NOT NULL CHECK (length(trim(reason)) > 0),
    unlocked_until timestamptz NOT NULL,
    unlocked_at timestamptz NOT NULL DEFAULT now(),
    unlocked_by uuid NOT NULL REFERENCES auth.users(id),
    revoked_at timestamptz,
    revoked_by uuid REFERENCES auth.users(id),
    CONSTRAINT month_unlocks_expiry_after_start CHECK (unlocked_until > unlocked_at)
);
CREATE INDEX IF NOT EXISTS month_unlocks_month_store_idx ON public.month_unlocks (month_start, store_id);
ALTER TABLE public.month_unlocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY month_unlocks_widget_select ON public.month_unlocks
    FOR SELECT TO authenticated USING (has_widget('imperial.retail_sales'));
REVOKE ALL ON public.month_unlocks FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.month_unlocks FROM authenticated;

-- Function: is_month_locked()
CREATE OR REPLACE FUNCTION public.is_month_locked(p_store_id uuid, p_date date)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_lock_day int;
    v_tz text;
    v_month date;
    v_lock_at timestamptz;
BEGIN
    SELECT value::int INTO v_lock_day FROM retail_settings WHERE key = 'lock_day';
    SELECT value INTO v_tz FROM retail_settings WHERE key = 'timezone';
    v_month := date_trunc('month', p_date)::date;
    v_lock_at := (
        (v_month + interval '1 month' + make_interval(days => v_lock_day - 1) + interval '23:59:59')::timestamp
        AT TIME ZONE v_tz
    );
    IF now() < v_lock_at THEN RETURN false; END IF;
    IF EXISTS (
        SELECT 1 FROM month_unlocks
        WHERE (store_id = p_store_id OR store_id IS NULL)
          AND month_start = v_month
          AND revoked_at IS NULL
          AND unlocked_until > now()
    ) THEN RETURN false; END IF;
    RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.is_month_locked(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_month_locked(uuid, date) TO authenticated;

-- Table: import_batches
CREATE TABLE IF NOT EXISTS public.import_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
    year_month date NOT NULL CHECK (extract(day FROM year_month) = 1),
    file_name text NOT NULL,
    storage_path text,
    row_count int NOT NULL DEFAULT 0,
    skipped_count int NOT NULL DEFAULT 0,
    replaced_count int NOT NULL DEFAULT 0,
    replace_reason text,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','failed')),
    error_detail jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid NOT NULL REFERENCES auth.users(id),
    CONSTRAINT import_batches_replace_needs_reason CHECK (
        replaced_count = 0 OR length(trim(coalesce(replace_reason,''))) > 0
    )
);
CREATE INDEX IF NOT EXISTS import_batches_store_month_idx ON public.import_batches (store_id, year_month);
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_batches_widget_select ON public.import_batches
    FOR SELECT TO authenticated USING (has_widget('imperial.retail_sales'));
REVOKE ALL ON public.import_batches FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.import_batches FROM authenticated;

-- Table: store_opening_balances
CREATE TABLE IF NOT EXISTS public.store_opening_balances (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
    opening_date date NOT NULL DEFAULT '2026-09-01',
    amount numeric(14,2) NOT NULL,
    source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','excel_import','csv_import')),
    set_by uuid NOT NULL REFERENCES auth.users(id),
    updated_by uuid REFERENCES auth.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT store_opening_balances_store_unique UNIQUE (store_id)
);
ALTER TABLE public.store_opening_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY sob_widget_select ON public.store_opening_balances
    FOR SELECT TO authenticated USING (has_widget('imperial.retail_sales'));
CREATE POLICY sob_storeuser_select ON public.store_opening_balances
    FOR SELECT TO authenticated USING (store_id = retail_store_for_user());
REVOKE ALL ON public.store_opening_balances FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.store_opening_balances FROM authenticated;

-- Table: daily_sales
CREATE TABLE IF NOT EXISTS public.daily_sales (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
    sales_date date NOT NULL,
    import_batch_id uuid REFERENCES public.import_batches(id),
    allied_bank_cc_sale numeric(14,2) NOT NULL DEFAULT 0 CHECK (allied_bank_cc_sale >= 0),
    hbl_cc_sale numeric(14,2) NOT NULL DEFAULT 0 CHECK (hbl_cc_sale >= 0),
    gift_karte numeric(14,2) NOT NULL DEFAULT 0 CHECK (gift_karte >= 0),
    credit_notes_issue numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit_notes_issue >= 0),
    gift_vouchers numeric(14,2) NOT NULL DEFAULT 0 CHECK (gift_vouchers >= 0),
    cash_sale numeric(14,2) NOT NULL DEFAULT 0 CHECK (cash_sale >= 0),
    campaign_float_cash numeric(14,2) NOT NULL DEFAULT 0,
    expenses numeric(14,2) NOT NULL DEFAULT 0 CHECK (expenses >= 0),
    other_income numeric(14,2) NOT NULL DEFAULT 0 CHECK (other_income >= 0),
    deposit numeric(14,2) NOT NULL DEFAULT 0 CHECK (deposit >= 0),
    remarks text,
    total_credit_card_sale numeric(14,2) GENERATED ALWAYS AS (allied_bank_cc_sale + hbl_cc_sale) STORED,
    total_sale numeric(14,2) GENERATED ALWAYS AS (
        cash_sale + allied_bank_cc_sale + hbl_cc_sale + gift_karte + gift_vouchers - credit_notes_issue
    ) STORED,
    net_cash_movement numeric(14,2) GENERATED ALWAYS AS (
        cash_sale + campaign_float_cash + other_income - expenses - deposit
    ) STORED,
    status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','imported','edited','reconciled','locked')),
    source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','excel_import')),
    bank_reconciled boolean,
    sap_reconciled boolean,
    variance numeric(14,2),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid NOT NULL REFERENCES auth.users(id),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid REFERENCES auth.users(id),
    deleted_at timestamptz,
    deleted_by uuid REFERENCES auth.users(id),
    delete_reason text,
    CONSTRAINT daily_sales_import_consistency CHECK (
        (source = 'excel_import') = (import_batch_id IS NOT NULL)
    ),
    CONSTRAINT daily_sales_soft_delete_consistency CHECK (
        (deleted_at IS NULL AND deleted_by IS NULL AND delete_reason IS NULL)
        OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_sales_store_date_active_unique
    ON public.daily_sales (store_id, sales_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS daily_sales_import_batch_idx
    ON public.daily_sales (import_batch_id) WHERE import_batch_id IS NOT NULL;

ALTER TABLE public.daily_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY daily_sales_select_widget ON public.daily_sales
    FOR SELECT TO authenticated
    USING (deleted_at IS NULL AND has_widget('imperial.retail_sales'));
CREATE POLICY daily_sales_select_deleted_hod ON public.daily_sales
    FOR SELECT TO authenticated
    USING (deleted_at IS NOT NULL AND has_widget('imperial.retail_sales_hod'));
CREATE POLICY daily_sales_select_own ON public.daily_sales
    FOR SELECT TO authenticated
    USING (deleted_at IS NULL AND store_id = retail_store_for_user());
CREATE POLICY daily_sales_insert_own ON public.daily_sales
    FOR INSERT TO authenticated
    WITH CHECK (store_id = retail_store_for_user());
REVOKE ALL ON public.daily_sales FROM anon;
REVOKE UPDATE, DELETE ON public.daily_sales FROM authenticated;

-- Table: daily_sales_audit
CREATE TABLE IF NOT EXISTS public.daily_sales_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name text NOT NULL CHECK (table_name IN (
        'daily_sales','store_opening_balances','month_unlocks','import_batches','daily_sales_attachments'
    )),
    record_id uuid NOT NULL,
    store_id uuid REFERENCES public.stores(id),
    action text NOT NULL CHECK (action IN (
        'insert','update','soft_delete','import','replace','reopen','revoke_reopen',
        'set_opening','edit_opening','attach'
    )),
    old_data jsonb,
    new_data jsonb,
    changed_by uuid REFERENCES auth.users(id),
    changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS daily_sales_audit_record_idx ON public.daily_sales_audit (table_name, record_id);
CREATE INDEX IF NOT EXISTS daily_sales_audit_store_time_idx ON public.daily_sales_audit (store_id, changed_at DESC);
ALTER TABLE public.daily_sales_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_widget_select ON public.daily_sales_audit
    FOR SELECT TO authenticated USING (has_widget('imperial.retail_sales'));
REVOKE ALL ON public.daily_sales_audit FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.daily_sales_audit FROM authenticated;

-- Table: daily_sales_attachments
CREATE TABLE IF NOT EXISTS public.daily_sales_attachments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    daily_sale_id uuid NOT NULL REFERENCES public.daily_sales(id) ON DELETE RESTRICT,
    store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
    storage_path text NOT NULL,
    file_name text NOT NULL,
    file_size_bytes int,
    content_type text,
    uploaded_by uuid NOT NULL REFERENCES auth.users(id),
    uploaded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.daily_sales_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY dsa_widget_select ON public.daily_sales_attachments
    FOR SELECT TO authenticated USING (has_widget('imperial.retail_sales'));
CREATE POLICY dsa_select_own ON public.daily_sales_attachments
    FOR SELECT TO authenticated USING (
        store_id = retail_store_for_user()
        AND daily_sale_id IN (SELECT id FROM daily_sales WHERE store_id = retail_store_for_user())
    );
REVOKE ALL ON public.daily_sales_attachments FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.daily_sales_attachments FROM authenticated;

-- View: daily_sales_computed (security_invoker = true)
CREATE OR REPLACE VIEW public.daily_sales_computed WITH (security_invoker = true) AS
SELECT
    ds.*,
    sob.amount AS opening_balance,
    CASE
        WHEN sob.amount IS NULL THEN NULL
        ELSE sob.amount + SUM(ds.net_cash_movement) OVER (
            PARTITION BY ds.store_id
            ORDER BY ds.sales_date
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) - ds.net_cash_movement
    END AS running_opening,
    CASE
        WHEN sob.amount IS NULL THEN NULL
        ELSE sob.amount + SUM(ds.net_cash_movement) OVER (
            PARTITION BY ds.store_id
            ORDER BY ds.sales_date
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )
    END AS closing_balance
FROM public.daily_sales ds
LEFT JOIN public.store_opening_balances sob ON sob.store_id = ds.store_id
WHERE ds.deleted_at IS NULL;

-- ============================================================
-- SOURCE: supabase/256_null_safe_soft_delete_guard.sql
-- COALESCE fix for SECURITY INVOKER triggers using GUC mode flags
-- ============================================================
-- Key fix: COALESCE(current_setting('retail_sales.soft_delete_mode', true) = 'true'
--           AND current_user <> 'authenticated', false)
-- Applied in daily_sales_before_update() trigger function.
-- (Full trigger body in supabase/256_null_safe_soft_delete_guard.sql)

-- ============================================================
-- SOURCE: supabase/257_member_permissions_daily_sales.sql
-- ============================================================
ALTER TABLE public.member_permissions
    ADD COLUMN IF NOT EXISTS can_access_daily_sales boolean NOT NULL DEFAULT false;

-- ============================================================
-- SOURCE: supabase/260_strict_store_isolation.sql
-- ============================================================

-- Hardened retail_store_for_user() with email check
CREATE OR REPLACE FUNCTION public.retail_store_for_user()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT s.id
    FROM public.store_users su
    JOIN public.stores s ON s.id = su.store_id
    WHERE su.user_id = auth.uid()
      AND su.is_primary = true
      AND s.is_active = true
      AND lower(s.email) = lower(auth.email())
    LIMIT 1
$$;

-- Trigger: store_users email match check
CREATE OR REPLACE FUNCTION public.store_users_email_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM auth.users au
        JOIN public.stores s ON s.id = NEW.store_id
        WHERE au.id = NEW.user_id
          AND lower(au.email) = lower(s.email)
    ) THEN
        RAISE EXCEPTION 'Store email does not match user email — link rejected';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER store_users_email_match_check
    BEFORE INSERT OR UPDATE ON public.store_users
    FOR EACH ROW EXECUTE FUNCTION public.store_users_email_check();

-- ============================================================
-- Storage buckets (applied via Supabase dashboard/API)
-- ============================================================
-- retail-sales: private, 10 MB limit, allowed types: image/*, application/pdf
-- retail-sales-imports: private, 50 MB limit, allowed types: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, text/csv

-- ============================================================
-- Widget keys (in app/lib/widgetRegistry.ts — NOT in DB)
-- ============================================================
-- imperial.retail_sales        — view + data entry (Finance Managers)
-- imperial.retail_sales_hod    — soft delete + reopen month (HOD only)

-- ============================================================
-- Store accounts (2 created, 31 pending)
-- ============================================================
-- store061@unze.co.uk  user_id: 296457c1-0ae0-40f7-97fb-52df464c904d  store_id: 37cdb99e
-- store029@unze.co.uk  user_id: b70c1ff8-416b-48eb-8601-1d69becfcdf2  store_id: 275eb821
-- Provisioned via supabase.auth.admin.createUser — NEVER via SQL INSERT

-- END OF SCHEMA BACKUP 2026-10-08
