-- =============================================================================
-- MIGRATION 254: Retail Stores
-- Project: ffwdubfkcaoiyohscael (Unze Dashboard)
-- Apply manually via Supabase SQL Editor. DO NOT auto-run.
--
-- STATUS: Awaiting UUID verification results and Khuram approval.
-- All admin_location_ids confirmed from ifpl_pnl_lines + admin_locations (2026-10-07).
-- Assertions at the bottom will fail the migration if anything is wrong.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. has_widget()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_widget(p_key text)
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
    WHERE lower(m.email) = lower(auth.email())
      AND mwo.widget_key = p_key
      AND mwo.visible = true
  );
$$;

REVOKE ALL ON FUNCTION public.has_widget(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_widget(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. stores table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stores (
    id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    fm_code                 text        NOT NULL,
    name                    text        NOT NULL,
    email                   text,
    pnl_branch_name         text,
    admin_location_id       uuid        REFERENCES public.admin_locations(id),
    is_active               boolean     NOT NULL DEFAULT true,
    manual_entry_start_date date        NOT NULL DEFAULT '2026-10-07',
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS stores_fm_code_unique
    ON public.stores (fm_code);

CREATE UNIQUE INDEX IF NOT EXISTS stores_email_lower_unique
    ON public.stores (lower(email)) WHERE email IS NOT NULL;

COMMENT ON TABLE public.stores IS
    'One row per IFPL retail store. fm_code matches company FM codes (019–062). '
    'email is store{fm_code}@unze.co.uk — set at provisioning time. '
    'pnl_branch_name is the exact branch string in ifpl_pnl_lines.branch. '
    'admin_location_id links to admin_locations (entity=IFPL, location_type=retail).';

-- ---------------------------------------------------------------------------
-- 3. store_users — links auth.users to a store
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.store_users (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    store_id   uuid        NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    is_primary boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, store_id)
);

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.stores      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stores_widget_select"
    ON public.stores FOR SELECT TO authenticated
    USING ( public.has_widget('imperial.retail_sales') );

CREATE POLICY "stores_storeuser_select"
    ON public.stores FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.store_users su
            WHERE su.store_id = stores.id
              AND su.user_id  = auth.uid()
        )
    );

CREATE POLICY "stores_service_role_all"
    ON public.stores FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "store_users_widget_select"
    ON public.store_users FOR SELECT TO authenticated
    USING ( public.has_widget('imperial.retail_sales') );

CREATE POLICY "store_users_self_select"
    ON public.store_users FOR SELECT TO authenticated
    USING ( user_id = auth.uid() );

CREATE POLICY "store_users_service_role_all"
    ON public.store_users FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 5. retail_store_for_user()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retail_store_for_user()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT su.store_id
  FROM   public.store_users su
  WHERE  su.user_id    = auth.uid()
    AND  su.is_primary = true
  LIMIT  1;
$$;

REVOKE ALL ON FUNCTION public.retail_store_for_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retail_store_for_user() TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Seed: 33 IFPL retail stores
--
-- email = store{fm_code}@unze.co.uk  (provisioned separately via server script)
-- pnl_branch_name = exact string in ifpl_pnl_lines.branch
-- admin_location_id = current location_id from ifpl_pnl_lines (confirmed 2026-10-07)
--
-- FM 028: admin_locations.name = "Centaurus Mall"; P&L name = "Islamabad"
--         pnl_branch_aliases already maps (IFPL,'Islamabad') → cd46204e ✓
-- FM 029: stores.name = "Mall of Sialkot" (canonical); pnl_branch_name = "Sialkot Store"
--         (current P&L name); update pnl_branch_name to "Mall of Sialkot" after 257
-- FM 032: separate store from FM 020; pnl_branch_name = "Packages Mall Mega Store"
-- FM 061: admin_locations.name = "Kooh I Noor" until migration 257
-- FM 023/030: using current location_ids (Jul 2026+); old IDs still in P&L history
-- ---------------------------------------------------------------------------

INSERT INTO public.stores (fm_code, name, email, pnl_branch_name, admin_location_id)
VALUES
    ('019', 'DHA',                  'store019@unze.co.uk', 'DHA',                     'f99d20e6-8079-4813-abdb-57c528abc480'),
    ('020', 'Packages Mall',        'store020@unze.co.uk', 'Packages Mall',            'dfb72381-5746-4481-a57a-b7c02decf1ad'),
    ('022', 'Faisalabad',           'store022@unze.co.uk', 'Faisalabad',               'ce4ea960-7f78-4023-a6c2-1b9b9ed34e23'),
    ('023', 'Iqbal Town',           'store023@unze.co.uk', 'Iqbal Town',               '3b3ed10b-8370-48a1-9639-91cd5bdc4c13'),
    ('025', 'LDS Jhang',            'store025@unze.co.uk', 'LDS Jhang',                '57abb578-0ab1-4ce3-8b4f-3e72c9faecd9'),
    ('026', 'Mall of Multan',       'store026@unze.co.uk', 'Mall of Multan',           '2ce8d9be-45ac-4958-86ad-37a0109bf82b'),
    ('027', 'Peshawar 1',           'store027@unze.co.uk', 'Peshawar 1',               '5c38f76f-3a4e-4316-881d-2e6102d0e5f0'),
    ('028', 'Islamabad',            'store028@unze.co.uk', 'Islamabad',                'cd46204e-3ad1-4433-afb1-961526652f95'),
    ('029', 'Mall of Sialkot',      'store029@unze.co.uk', 'Sialkot Store',            '6272c731-d84d-4b2b-990a-6b720513bb8a'),
    ('030', 'Emporium Mall',        'store030@unze.co.uk', 'Emporium Mall',            '980303a5-f4fd-41ef-a96d-1d7e1a946863'),
    ('032', 'Packages Mall Mega',   'store032@unze.co.uk', 'Packages Mall Mega Store', 'c1c5e9cb-b41a-4631-ae2a-3885c5d51fdd'),
    ('034', 'Lucky One Mall',       'store034@unze.co.uk', 'Lucky One Mall',           '7981846b-448a-4dc1-bd10-97d6bb582925'),
    ('041', 'Gujranwala',           'store041@unze.co.uk', 'Gujranwala',               '61f67f2d-0f89-40d7-9e09-f47bd377f034'),
    ('043', 'Dolmen Mall',          'store043@unze.co.uk', 'Dolmen Mall',              'd4a259d0-e658-4ad0-9745-425c9e80733e'),
    ('044', 'Amanah Mall',          'store044@unze.co.uk', 'Amanah Mall',              '5af5e159-6e13-4db4-bcca-1b97c1e89a48'),
    ('045', 'Liberty Store',        'store045@unze.co.uk', 'Liberty Store',            '0c82eb2f-0502-4d16-9800-e8945f84020f'),
    ('046', 'Giga Mall',            'store046@unze.co.uk', 'Giga Mall',                '19a82e74-f831-4855-b96b-cbb418350dee'),
    ('047', 'Tariq Road',           'store047@unze.co.uk', 'Tariq Road',               '2a5f61e9-207d-4cf0-8f44-1ce80cb6eb65'),
    ('048', 'Lake City',            'store048@unze.co.uk', 'Lake City',                '775d65a4-1984-42fc-bad2-e484991c8df3'),
    ('049', 'Sahiwal',              'store049@unze.co.uk', 'Sahiwal',                  '259d2cfb-ba36-4bda-91e0-2c1e2ded2ee2'),
    ('050', 'Bahria Town',          'store050@unze.co.uk', 'Bahria Town',              '95ace3ea-f30b-416e-a228-646fbbfc3c42'),
    ('051', 'V Mall Sialkot',       'store051@unze.co.uk', 'V Mall Sialkot',           'b8a21446-0659-4e85-b0c8-0e53e3177bd0'),
    ('052', 'Hyderabad',            'store052@unze.co.uk', 'Hyderabad',                '3bd9c24b-ffc8-495b-903c-1493aa04bc54'),
    ('053', 'Hurrianwala',          'store053@unze.co.uk', 'Hurrianwala',              'd511ce5e-8648-4e35-9e8e-dc0a66a5e4b5'),
    ('054', 'Capital Square',       'store054@unze.co.uk', 'Capital Square',           '5f986e17-c113-4ec8-ae1f-283dbffa0646'),
    ('055', 'Hakim Mall',           'store055@unze.co.uk', 'Hakim Mall',               '7b3ac061-b916-4353-a54c-3592bdf574df'),
    ('056', 'Mardan',               'store056@unze.co.uk', 'Mardan',                   'efa48a85-daf8-4a46-99d0-ac21bc728d50'),
    ('057', 'Sufi City',            'store057@unze.co.uk', 'Sufi City',                'd544534d-bff2-43a9-abaf-aadf2624429e'),
    ('058', 'Usman Mall',           'store058@unze.co.uk', 'Usman Mall',               '16f4cc13-0a23-4f47-a7b9-532536b3d259'),
    ('059', 'Swat',                 'store059@unze.co.uk', 'Swat',                     'd1ec7b8d-ef6e-4cf5-8210-18596c616501'),
    ('060', 'Kharian',              'store060@unze.co.uk', 'Kharian',                  '2ddb14be-c03d-4891-875b-4f914ed76900'),
    ('061', 'Faisalabad KN',        'store061@unze.co.uk', 'Faisalabad KN',            '4de328e6-52ad-4679-8ec9-c6bbe0a85cc4'),
    ('062', 'Sukkur',               'store062@unze.co.uk', 'Sukkur',                   '8389ced8-2e4b-4dff-a04f-e49b2c6fe6f3')

ON CONFLICT (fm_code) DO UPDATE SET
    name              = EXCLUDED.name,
    email             = EXCLUDED.email,
    pnl_branch_name   = EXCLUDED.pnl_branch_name,
    admin_location_id = EXCLUDED.admin_location_id,
    updated_at        = now();

-- ---------------------------------------------------------------------------
-- 7. Assertions — fail the migration if anything is wrong
-- ---------------------------------------------------------------------------

-- Assert: exactly 33 stores, 33 unique FM codes, 33 unique emails
DO $$
DECLARE
    v_count        int;
    v_fm_unique    int;
    v_email_unique int;
BEGIN
    SELECT COUNT(*)            INTO v_count        FROM public.stores;
    SELECT COUNT(DISTINCT fm_code) INTO v_fm_unique FROM public.stores;
    SELECT COUNT(DISTINCT lower(email))
        INTO v_email_unique FROM public.stores WHERE email IS NOT NULL;

    IF v_count <> 33 THEN
        RAISE EXCEPTION 'Assert failed: expected 33 stores, got %', v_count;
    END IF;
    IF v_fm_unique <> 33 THEN
        RAISE EXCEPTION 'Assert failed: expected 33 unique FM codes, got %', v_fm_unique;
    END IF;
    IF v_email_unique <> 33 THEN
        RAISE EXCEPTION 'Assert failed: expected 33 unique emails, got %', v_email_unique;
    END IF;
    RAISE NOTICE 'Assert OK: 33 stores / 33 FM codes / 33 emails';
END;
$$;

-- Assert: every admin_location_id references an active IFPL retail location
DO $$
DECLARE
    v_bad int;
    v_msg text;
BEGIN
    SELECT COUNT(*) INTO v_bad
    FROM public.stores s
    LEFT JOIN public.admin_locations al
           ON al.id = s.admin_location_id
          AND al.entity        = 'IFPL'
          AND al.location_type = 'retail'
          AND al.is_active     = true
    WHERE s.admin_location_id IS NOT NULL
      AND al.id IS NULL;

    IF v_bad > 0 THEN
        SELECT string_agg(s.fm_code || ' ' || s.name, ', ') INTO v_msg
        FROM public.stores s
        LEFT JOIN public.admin_locations al
               ON al.id = s.admin_location_id
              AND al.entity        = 'IFPL'
              AND al.location_type = 'retail'
              AND al.is_active     = true
        WHERE s.admin_location_id IS NOT NULL
          AND al.id IS NULL;
        RAISE EXCEPTION 'Assert failed: % store(s) have invalid admin_location_id: %', v_bad, v_msg;
    END IF;
    RAISE NOTICE 'Assert OK: all admin_location_ids are valid IFPL retail locations';
END;
$$;

-- ---------------------------------------------------------------------------
-- NOTE: pnl_branch_aliases is NOT modified here.
-- Existing aliases cover all name mismatches. Aliases for 'Kooh I Noor' and
-- 'Sialkot Store' will be added in migration 257 after admin_locations rename.
-- ---------------------------------------------------------------------------
