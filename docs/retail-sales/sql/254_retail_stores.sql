-- ============================================================
-- Migration 254: Retail stores, store users, access helpers
-- Additive only. Apply manually in the Supabase SQL editor.
-- ============================================================
BEGIN;

-- 1. stores
CREATE TABLE public.stores (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fm_code                  text        NOT NULL CHECK (fm_code ~ '^[0-9]{3}$'),
  name                     text        NOT NULL,
  email                    text        NOT NULL CHECK (email = lower(email)),
  admin_location_id        uuid        REFERENCES public.admin_locations(id) ON DELETE SET NULL,
  pnl_branch_name          text,
  manual_entry_start_date  date        NOT NULL DEFAULT '2026-10-07',
  is_active                boolean     NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stores_fm_code_unique UNIQUE (fm_code)
);
CREATE UNIQUE INDEX stores_email_lower_unique ON public.stores (lower(email));

-- 2. store_users (one primary store per user now; multi-store possible later)
CREATE TABLE public.store_users (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id    uuid        NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  is_primary  boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_users_user_store_unique UNIQUE (user_id, store_id)
);
CREATE UNIQUE INDEX store_users_one_primary ON public.store_users (user_id) WHERE is_primary;
CREATE INDEX store_users_store_id_idx ON public.store_users (store_id);

-- 3. has_widget(): server-side widget check (no row = denied)
CREATE OR REPLACE FUNCTION public.has_widget(p_widget_key text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.member_widget_overrides mwo
    JOIN public.members m ON m.id = mwo.member_id
    WHERE lower(m.email) = lower(auth.email())
      AND mwo.widget_key = p_widget_key
      AND mwo.visible = true
  );
$$;
REVOKE ALL ON FUNCTION public.has_widget(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_widget(text) TO authenticated;

-- 4. retail_store_for_user(): the caller's active primary store id, or NULL
CREATE OR REPLACE FUNCTION public.retail_store_for_user()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT su.store_id
  FROM public.store_users su
  JOIN public.stores s ON s.id = su.store_id
  WHERE su.user_id = auth.uid()
    AND su.is_primary
    AND s.is_active
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.retail_store_for_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retail_store_for_user() TO authenticated;

-- 5. RLS (deny by default; writes only via service role)
ALTER TABLE public.stores      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY stores_select_own ON public.stores
  FOR SELECT TO authenticated
  USING (id = public.retail_store_for_user());

CREATE POLICY stores_select_widget ON public.stores
  FOR SELECT TO authenticated
  USING (public.has_widget('imperial.retail_sales'));

CREATE POLICY store_users_select_own ON public.store_users
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY store_users_select_widget ON public.store_users
  FOR SELECT TO authenticated
  USING (public.has_widget('imperial.retail_sales'));

REVOKE INSERT, UPDATE, DELETE ON public.stores, public.store_users FROM anon, authenticated;

-- 6. Seed: 33 IFPL stores
INSERT INTO public.stores (fm_code, name, email, admin_location_id, pnl_branch_name) VALUES
  ('019','DHA',                'store019@unze.co.uk','f99d20e6-8079-4813-abdb-57c528abc480','DHA'),
  ('020','Packages Mall',      'store020@unze.co.uk','dfb72381-5746-4481-a57a-b7c02decf1ad','Packages Mall'),
  ('022','Faisalabad',         'store022@unze.co.uk','ce4ea960-7f78-4023-a6c2-1b9b9ed34e23','Faisalabad'),
  ('023','Iqbal Town',         'store023@unze.co.uk','3b3ed10b-8370-48a1-9639-91cd5bdc4c13','Iqbal Town'),
  ('025','LDS Jhang',          'store025@unze.co.uk','57abb578-0ab1-4ce3-8b4f-3e72c9faecd9','LDS Jhang'),
  ('026','Mall of Multan',     'store026@unze.co.uk','2ce8d9be-45ac-4958-86ad-37a0109bf82b','Mall of Multan'),
  ('027','Peshawar 1',         'store027@unze.co.uk','5c38f76f-3a4e-4316-881d-2e6102d0e5f0','Peshawar 1'),
  ('028','Islamabad',          'store028@unze.co.uk','cd46204e-3ad1-4433-afb1-961526652f95','Islamabad'),
  ('029','Mall of Sialkot',    'store029@unze.co.uk','6272c731-d84d-4b2b-990a-6b720513bb8a','Sialkot Store'),
  ('030','Emporium Mall',      'store030@unze.co.uk','980303a5-f4fd-41ef-a96d-1d7e1a946863','Emporium Mall'),
  ('032','Packages Mall Mega', 'store032@unze.co.uk','c1c5e9cb-b41a-4631-ae2a-3885c5d51fdd','Packages Mall Mega Store'),
  ('034','Lucky One Mall',     'store034@unze.co.uk','7981846b-448a-4dc1-bd10-97d6bb582925','Lucky One Mall'),
  ('041','Gujranwala',         'store041@unze.co.uk','61f67f2d-0f89-40d7-9e09-f47bd377f034','Gujranwala'),
  ('043','Dolmen Mall',        'store043@unze.co.uk','d4a259d0-e658-4ad0-9745-425c9e80733e','Dolmen Mall'),
  ('044','Amanah Mall',        'store044@unze.co.uk','5af5e159-6e13-4db4-bcca-1b97c1e89a48','Amanah Mall'),
  ('045','Liberty Store',      'store045@unze.co.uk','0c82eb2f-0502-4d16-9800-e8945f84020f','Liberty Store'),
  ('046','Giga Mall',          'store046@unze.co.uk','19a82e74-f831-4855-b96b-cbb418350dee','Giga Mall'),
  ('047','Tariq Road',         'store047@unze.co.uk','2a5f61e9-207d-4cf0-8f44-1ce80cb6eb65','Tariq Road'),
  ('048','Lake City',          'store048@unze.co.uk','775d65a4-1984-42fc-bad2-e484991c8df3','Lake City'),
  ('049','Sahiwal',            'store049@unze.co.uk','259d2cfb-ba36-4bda-91e0-2c1e2ded2ee2','Sahiwal'),
  ('050','Bahria Town',        'store050@unze.co.uk','95ace3ea-f30b-416e-a228-646fbbfc3c42','Bahria Town'),
  ('051','V Mall Sialkot',     'store051@unze.co.uk','b8a21446-0659-4e85-b0c8-0e53e3177bd0','V Mall Sialkot'),
  ('052','Hyderabad',          'store052@unze.co.uk','3bd9c24b-ffc8-495b-903c-1493aa04bc54','Hyderabad'),
  ('053','Hurrianwala',        'store053@unze.co.uk','d511ce5e-8648-4e35-9e8e-dc0a66a5e4b5','Hurrianwala'),
  ('054','Capital Square',     'store054@unze.co.uk','5f986e17-c113-4ec8-ae1f-283dbffa0646','Capital Square'),
  ('055','Hakim Mall',         'store055@unze.co.uk','7b3ac061-b916-4353-a54c-3592bdf574df','Hakim Mall'),
  ('056','Mardan',             'store056@unze.co.uk','efa48a85-daf8-4a46-99d0-ac21bc728d50','Mardan'),
  ('057','Sufi City',          'store057@unze.co.uk','d544534d-bff2-43a9-abaf-aadf2624429e','Sufi City'),
  ('058','Usman Mall',         'store058@unze.co.uk','16f4cc13-0a23-4f47-a7b9-532536b3d259','Usman Mall'),
  ('059','Swat',               'store059@unze.co.uk','d1ec7b8d-ef6e-4cf5-8210-18596c616501','Swat'),
  ('060','Kharian',            'store060@unze.co.uk','2ddb14be-c03d-4891-875b-4f914ed76900','Kharian'),
  ('061','Faisalabad KN',      'store061@unze.co.uk','4de328e6-52ad-4679-8ec9-c6bbe0a85cc4','Faisalabad KN'),
  ('062','Sukkur',             'store062@unze.co.uk','8389ced8-2e4b-4dff-a04f-e49b2c6fe6f3','Sukkur');

-- 7. Assertions: the whole migration rolls back if any fail
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.stores;
  IF n <> 33 THEN RAISE EXCEPTION 'Expected 33 stores, found %', n; END IF;

  SELECT count(*) INTO n FROM public.stores
  WHERE email <> 'store' || fm_code || '@unze.co.uk';
  IF n > 0 THEN RAISE EXCEPTION '% stores have an email that does not match their FM code', n; END IF;

  SELECT count(*) INTO n
  FROM public.stores s
  LEFT JOIN public.admin_locations al ON al.id = s.admin_location_id
  WHERE al.id IS NULL
     OR al.entity <> 'IFPL'
     OR al.location_type <> 'retail'
     OR al.is_active IS NOT TRUE;
  IF n > 0 THEN RAISE EXCEPTION '% stores have a missing or non-IFPL-retail-active location', n; END IF;
END $$;

COMMIT;

-- ROLLBACK (only valid before 255 is applied, since 255 depends on these):
-- BEGIN;
-- DROP TABLE IF EXISTS public.store_users;
-- DROP TABLE IF EXISTS public.stores;
-- DROP FUNCTION IF EXISTS public.retail_store_for_user();
-- DROP FUNCTION IF EXISTS public.has_widget(text);
-- COMMIT;
