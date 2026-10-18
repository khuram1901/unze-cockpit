-- ============================================================
-- 278_generators_import.sql
-- Seed 23 generators + 23 historical diesel refuel rows
-- ============================================================

-- ── Step 1: Resolve location IDs ──────────────────────────────────────
-- (UUIDs confirmed from admin_locations query on 2026-10-18)

DO $$
DECLARE
  -- Matched locations (existing admin_locations rows)
  loc_ho62xx   uuid := '9a63967c-3304-410b-9ca1-dcccc650ea8f'; -- Head Office 62-XX (Gen-61 + Gen-62 both here)
  loc_wgaju    uuid; -- Warehouse Gajumatta
  loc_dhayb    uuid := '2f05fc9b-a438-4dbd-82f4-89a6bc4f3b2d'; -- DHA Y Block (first row)
  loc_iqbal    uuid := '3b3ed10b-8370-48a1-9639-91cd5bdc4c13'; -- Iqbal Town
  loc_ldsjh    uuid := '57abb578-0ab1-4ce3-8b4f-3e72c9faecd9'; -- LDS Jhang
  loc_pesha    uuid := '62a90f98-e51f-4313-87a2-95d0ce063916'; -- Peshawar
  loc_gujrw    uuid := '61f67f2d-0f89-40d7-9e09-f47bd377f034'; -- Gujranwala
  loc_liber    uuid := '0c82eb2f-0502-4d16-9800-e8945f84020f'; -- Liberty Store
  loc_tariq    uuid := '2a5f61e9-207d-4cf0-8f44-1ce80cb6eb65'; -- Tariq Road
  loc_sahiw    uuid := '259d2cfb-ba36-4bda-91e0-2c1e2ded2ee2'; -- Sahiwal
  loc_vmall    uuid := 'b8a21446-0659-4e85-b0c8-0e53e3177bd0'; -- V Mall Sialkot
  loc_hurri    uuid := 'd511ce5e-8648-4e35-9e8e-dc0a66a5e4b5'; -- Hurrianwala
  loc_marda    uuid := 'efa48a85-daf8-4a46-99d0-ac21bc728d50'; -- Mardan
  loc_swat     uuid := 'd1ec7b8d-ef6e-4cf5-8210-18596c616501'; -- Swat
  loc_khari    uuid := '2ddb14be-c03d-4891-875b-4f914ed76900'; -- Kharian
  loc_fskn    uuid := '4de328e6-52ad-4679-8ec9-c6bbe0a85cc4'; -- Faisalabad KN
  loc_sukkr    uuid := '8389ced8-2e4b-4dff-a04f-e49b2c6fe6f3'; -- Sukkur
  -- New locations (inserted in 276)
  loc_kamrn    uuid;
  loc_khurm    uuid;
  loc_barny    uuid;
  loc_barnr    uuid;

  -- Generator IDs
  g_kamrn uuid; g_khurm uuid;
  g_ho62  uuid; g_ho61  uuid;  -- both at Head Office 62-XX, Gen-62 and Gen-61
  g_wgaju uuid; g_dhayb uuid;  g_iqbal uuid;
  g_ldsjh uuid; g_pesha uuid;  g_gujrw uuid;
  g_liber uuid; g_tariq uuid;  g_sahiw uuid;
  g_vmall uuid; g_hurri uuid;  g_marda uuid;
  g_swat  uuid; g_khari uuid;  g_fskn  uuid;
  g_sukkr uuid; g_barny uuid;  g_barnr uuid;

BEGIN
  -- Resolve new location IDs
  SELECT id INTO loc_wgaju FROM admin_locations WHERE name = 'Warehouse Gajumatta';
  SELECT id INTO loc_kamrn FROM admin_locations WHERE name = '482XX - Kamran';
  SELECT id INTO loc_khurm FROM admin_locations WHERE name = 'W210 - Khuram';
  SELECT id INTO loc_barny FROM admin_locations WHERE name = 'Baranh Y-Block';
  SELECT id INTO loc_barnr FROM admin_locations WHERE name = 'Baranh Raya';

  -- ── Insert generators ─────────────────────────────────────────────
  INSERT INTO generators (location_id, kva, model, label) VALUES (loc_kamrn, 30, 'YD-China', NULL)       RETURNING id INTO g_kamrn;
  INSERT INTO generators (location_id, kva, model, label) VALUES (loc_khurm, 30, 'YD-China', NULL)       RETURNING id INTO g_khurm;
  INSERT INTO generators (location_id, kva, model, label) VALUES (loc_ho62xx, 100, 'Cummins', 'Gen-62')  RETURNING id INTO g_ho62;
  INSERT INTO generators (location_id, kva, model, label) VALUES (loc_ho62xx, 50, 'Perkins', 'Gen-61')   RETURNING id INTO g_ho61;
  INSERT INTO generators (location_id, kva, model, label) VALUES (loc_wgaju, 13, 'Perkins', NULL)        RETURNING id INTO g_wgaju;
  INSERT INTO generators (location_id, kva, model, label) VALUES (loc_dhayb, 50, 'Perkins', NULL)        RETURNING id INTO g_dhayb;
  INSERT INTO generators (location_id, kva, model, label) VALUES (loc_iqbal, 30, 'YD-China', NULL)       RETURNING id INTO g_iqbal;
  INSERT INTO generators (location_id, kva, model, label) VALUES (loc_ldsjh, 100, 'Perkins', NULL)       RETURNING id INTO g_ldsjh;
  INSERT INTO generators (location_id, kva, model, label) VALUES (loc_pesha, 30, 'John Deere', NULL)     RETURNING id INTO g_pesha;
  INSERT INTO generators (location_id, kva, model, label) VALUES (loc_gujrw, 30, 'Perkins', NULL)        RETURNING id INTO g_gujrw;
  INSERT INTO generators (location_id, kva, model, label) VALUES (loc_liber, 30, 'YD-China', NULL)       RETURNING id INTO g_liber;
  INSERT INTO generators (location_id, kva, model, label) VALUES (loc_tariq, 50, 'John Deere', NULL)     RETURNING id INTO g_tariq;
  INSERT INTO generators (location_id, kva, model, label) VALUES (loc_sahiw, 30, 'Perkins', NULL)        RETURNING id INTO g_sahiw;
  INSERT INTO generators (location_id, kva, model, label) VALUES (loc_vmall, 30, 'Perkins', NULL)        RETURNING id INTO g_vmall;
  INSERT INTO generators (location_id, kva, model, label) VALUES (loc_hurri, 30, 'John Deere', NULL)     RETURNING id INTO g_hurri;
  INSERT INTO generators (location_id, kva, model, label) VALUES (loc_marda, 20, 'John Deere', NULL)     RETURNING id INTO g_marda;
  INSERT INTO generators (location_id, kva, model, label) VALUES (loc_swat,  30, 'Perkins', NULL)        RETURNING id INTO g_swat;
  INSERT INTO generators (location_id, kva, model, label) VALUES (loc_khari, 30, 'Perkins', NULL)        RETURNING id INTO g_khari;
  INSERT INTO generators (location_id, kva, model, label) VALUES (loc_fskn,  30, 'John Deere', NULL)     RETURNING id INTO g_fskn;
  INSERT INTO generators (location_id, kva, model, label) VALUES (loc_sukkr, 30, 'John Deere', NULL)     RETURNING id INTO g_sukkr;
  INSERT INTO generators (location_id, kva, model, label) VALUES (loc_barny, 100, 'John Deere', NULL)    RETURNING id INTO g_barny;
  INSERT INTO generators (location_id, kva, model, label) VALUES (loc_barnr, 200, 'Cummins', NULL)       RETURNING id INTO g_barnr;

  -- ── Insert historical seed refuels ────────────────────────────────
  -- present_hours = NULL (seed rows), previous_hours = starting meter reading
  -- Excel: Head Office 62-XX has TWO generators — Cummins row → Gen-62, Perkins row → Gen-61
  INSERT INTO generator_fuel_log
    (generator_id, refuel_date, previous_hours, present_hours, rate_per_litre, qty_litres, entered_by)
  VALUES
    (g_kamrn, '2026-09-07', 20,  NULL, 376, 200,  'import'),
    (g_khurm, '2026-09-09', 40,  NULL, 389, 400,  'import'),
    (g_ho62,  '2026-09-02', 25,  NULL, 369, 250,  'import'),  -- Gen-62 Cummins 100 KVA
    (g_ho61,  '2026-09-02', 20,  NULL, 369, 250,  'import'),  -- Gen-61 Perkins 50 KVA
    (g_wgaju, '2026-09-04', 18,  NULL, 372, 150,  'import'),
    (g_dhayb, '2026-09-02', 20,  NULL, 369, 300,  'import'),
    (g_iqbal, '2026-07-07', 20,  NULL, 369, 250,  'import'),
    (g_ldsjh, '2026-07-18', 20,  NULL, 357, 1500, 'import'),
    (g_pesha, '2026-10-10', 84,  NULL, 401, 250,  'import'),
    (g_gujrw, '2026-09-15', 20,  NULL, 407, 300,  'import'),
    (g_liber, '2026-09-01', 40,  NULL, 369, 305,  'import'),
    (g_tariq, '2026-09-06', 20,  NULL, 375, 372,  'import'),
    (g_sahiw, '2026-09-17', 20,  NULL, 417, 150,  'import'),
    (g_vmall, '2026-08-11', 20,  NULL, 378, 350,  'import'),
    (g_hurri, '2026-10-09', 20,  NULL, 400, 350,  'import'),
    (g_marda, '2026-09-03', 20,  NULL, 371, 300,  'import'),
    (g_swat,  '2026-08-24', 20,  NULL, 368, 400,  'import'),
    (g_khari, '2026-09-21', 20,  NULL, 421, 300,  'import'),
    (g_fskn,  '2026-09-12', 20,  NULL, 401, 268,  'import'),
    (g_sukkr, '2026-09-03', 21,  NULL, 371, 150,  'import'),
    (g_barny, '2026-10-06', 335, NULL, 403, 700,  'import'),
    (g_barnr, '2026-10-10', 31,  NULL, 400, 500,  'import');

  RAISE NOTICE 'Import complete: 22 generators + 22 seed fuel rows inserted';
  -- Note: 23 Excel rows but Head Office 62-XX appears twice for 2 generators
  -- so we have 22 distinct generators, 22 seed fuel rows
  -- (Maintenance tab has no data rows — generators only seeded above)
END;
$$;

-- ── ROLLBACK ──────────────────────────────────────────────────────────
-- DELETE FROM generator_fuel_log WHERE entered_by = 'import';
-- DELETE FROM generators;
