-- ─────────────────────────────────────────────────────────────────────
-- Migration 151 — Admin Operations
-- Tables: locations, vehicles, solar_branches, registrations,
--         eobi_payments, compliance, ntn_docs, restaurant_licences,
--         fuel_log, solar_readings, utility_readings, vehicle_maintenance
-- ─────────────────────────────────────────────────────────────────────

-- ── 1. MASTER LOCATIONS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_locations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  entity        text NOT NULL,        -- IFPL | Baranh | HD | UTPL
  location_type text NOT NULL,        -- retail | restaurant | plant | warehouse
  province      text,                 -- Punjab | Sindh | KPK
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── 2. VEHICLES ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_vehicles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  plate_number text NOT NULL UNIQUE,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── 3. SOLAR BRANCHES ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_solar_branches (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  system_kw  numeric,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── 4. REGISTRATIONS (EOBI + Social Security status) ─────────────────
CREATE TABLE IF NOT EXISTS admin_registrations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id       uuid NOT NULL REFERENCES admin_locations(id) ON DELETE CASCADE,
  registration_type text NOT NULL,    -- EOBI | Social Security
  status            text NOT NULL DEFAULT 'Pending', -- Registered | Pending | Inprocess | N/A
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text,             -- email of user who last updated
  notes             text,
  UNIQUE (location_id, registration_type)
);

-- ── 5. EOBI / SOCIAL SECURITY MONTHLY PAYMENTS ───────────────────────
CREATE TABLE IF NOT EXISTS admin_eobi_payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity         text NOT NULL,       -- IFPL | Baranh | HD | UTPL
  payment_type   text NOT NULL,       -- EOBI | Social Security
  month          date NOT NULL,       -- always first of month: 2026-07-01
  amount_pkr     numeric,
  date_paid      date NOT NULL,
  challan_number text,
  is_late        boolean GENERATED ALWAYS AS (
                   EXTRACT(DAY FROM date_paid) > 15
                 ) STORED,
  notes          text,
  created_by     text,               -- email of user who recorded
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity, payment_type, month)
);

-- ── 6. COMPLIANCE (Civil Defence, Labour Registration, Labour Inspection) ─
CREATE TABLE IF NOT EXISTS admin_compliance (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id      uuid NOT NULL REFERENCES admin_locations(id) ON DELETE CASCADE,
  compliance_type  text NOT NULL,     -- Civil Defence | Labour Registration | Labour Inspection
  status           text NOT NULL DEFAULT 'Pending', -- Done | Inprocess | Pending | Overdue
  last_renewed     date,
  next_due         date,
  notes            text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text,             -- email of user who last updated
  UNIQUE (location_id, compliance_type)
);

-- ── 7. NTN DOCUMENTS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_ntn_docs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id   uuid NOT NULL REFERENCES admin_locations(id) ON DELETE CASCADE,
  meter_label   text,                 -- 'Meter 1', 'Meter 2', etc.
  ntn_number    text,
  status        text NOT NULL DEFAULT 'Pending', -- Done | Pending | N/A
  folderit_link text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── 8. RESTAURANT LICENCES ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_restaurant_licences (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id   uuid NOT NULL REFERENCES admin_locations(id) ON DELETE CASCADE,
  licence_type  text NOT NULL,        -- PFA Licence | Medical Certificate | Training Certificate | Tourism Certificate
  status        text NOT NULL DEFAULT 'Pending', -- Done | Pending | N/A
  folderit_link text,
  expiry_date   date,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, licence_type)
);

-- ── 9. FUEL LOG ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_fuel_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id        uuid NOT NULL REFERENCES admin_vehicles(id),
  date              date NOT NULL,
  price_per_litre   numeric NOT NULL CHECK (price_per_litre > 0),
  quantity_litres   numeric NOT NULL CHECK (quantity_litres > 0),
  amount_pkr        numeric GENERATED ALWAYS AS
                      (ROUND(price_per_litre * quantity_litres, 2)) STORED,
  previous_odometer integer,
  current_odometer  integer,
  mileage_km        integer GENERATED ALWAYS AS (
                      CASE
                        WHEN current_odometer IS NOT NULL
                          AND previous_odometer IS NOT NULL
                          AND current_odometer > previous_odometer
                        THEN current_odometer - previous_odometer
                        ELSE NULL
                      END
                    ) STORED,
  km_per_litre      numeric GENERATED ALWAYS AS (
                      CASE
                        WHEN current_odometer IS NOT NULL
                          AND previous_odometer IS NOT NULL
                          AND current_odometer > previous_odometer
                          AND quantity_litres > 0
                        THEN ROUND(
                          (current_odometer - previous_odometer)::numeric / quantity_litres, 2
                        )
                        ELSE NULL
                      END
                    ) STORED,
  notes             text,
  entered_by        text,             -- email of user who entered
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_fuel_log_vehicle_date
  ON admin_fuel_log (vehicle_id, date DESC);

-- ── 10. SOLAR READINGS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_solar_readings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       uuid NOT NULL REFERENCES admin_solar_branches(id),
  date            date NOT NULL,
  production_kwh  numeric,
  status          text NOT NULL DEFAULT 'Active',
                  -- Active | Inverter Issue | Internet Issue | Solar Damage | Inactive
  notes           text,
  entered_by      text,             -- email of user who entered
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, date)
);

CREATE INDEX IF NOT EXISTS admin_solar_readings_branch_date
  ON admin_solar_readings (branch_id, date DESC);

-- ── 11. UTILITY READINGS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_utility_readings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id      uuid NOT NULL REFERENCES admin_locations(id),
  meter_label      text NOT NULL DEFAULT 'Meter 1',
  utility_company  text,              -- LESCO | MEPCO | FESCO | PESCO | HESCO | IESCO
  reading_date     date NOT NULL,
  current_reading  integer NOT NULL CHECK (current_reading >= 0),
  previous_reading integer,
  units_consumed   integer GENERATED ALWAYS AS (
                     CASE
                       WHEN previous_reading IS NOT NULL
                         AND current_reading > previous_reading
                       THEN current_reading - previous_reading
                       ELSE NULL
                     END
                   ) STORED,
  bill_amount_pkr  numeric,
  entered_by       text,             -- email of user who entered
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_utility_readings_loc_date
  ON admin_utility_readings (location_id, reading_date DESC);

-- ── 12. VEHICLE MAINTENANCE ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_vehicle_maintenance (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id       uuid NOT NULL REFERENCES admin_vehicles(id),
  date             date NOT NULL,
  work_type        text NOT NULL,
  description      text,
  odometer_km      integer,
  workshop         text,
  cost_pkr         numeric NOT NULL CHECK (cost_pkr >= 0),
  next_service_due text,              -- flexible: date or km string
  entered_by       text,             -- email of user who entered
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_vehicle_maintenance_vehicle_date
  ON admin_vehicle_maintenance (vehicle_id, date DESC);

-- ─────────────────────────────────────────────────────────────────────
-- RLS — all tables owned by service role; authenticated users read only
-- Entry tables (fuel, solar, utility, maintenance) allow authenticated
-- insert. Admin ops tables (registrations, payments, compliance, docs)
-- restrict writes to admin_ops capability (enforced in API routes).
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE admin_locations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_vehicles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_solar_branches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_registrations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_eobi_payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_compliance           ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_ntn_docs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_restaurant_licences  ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_fuel_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_solar_readings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_utility_readings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_vehicle_maintenance  ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read everything
CREATE POLICY "auth_read" ON admin_locations           FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON admin_vehicles            FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON admin_solar_branches      FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON admin_registrations       FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON admin_eobi_payments       FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON admin_compliance          FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON admin_ntn_docs            FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON admin_restaurant_licences FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON admin_fuel_log            FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON admin_solar_readings      FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON admin_utility_readings    FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON admin_vehicle_maintenance FOR SELECT TO authenticated USING (true);

-- Entry tables: authenticated users can insert (writes go through service role in API routes)
CREATE POLICY "auth_insert" ON admin_fuel_log            FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_insert" ON admin_solar_readings      FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_insert" ON admin_utility_readings    FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_insert" ON admin_vehicle_maintenance FOR INSERT TO authenticated WITH CHECK (true);

-- All writes to compliance/registration tables go through service-role API routes (no direct client policy needed)

-- ─────────────────────────────────────────────────────────────────────
-- SEED DATA — Vehicles
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO admin_vehicles (name, plate_number) VALUES
  ('BMW',         'AGK-001'),
  ('KIA Sportage','ASQ-321'),
  ('Santa Fe',    'VX-58'),
  ('KIA Sorento', 'ADK-824'),
  ('KIA',         'AEW-533'),
  ('MG',          'ADP-579'),
  ('Cab',         'CAB-3903'),
  ('Cal',         'CAL-8941')
ON CONFLICT (plate_number) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- SEED DATA — Solar Branches
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO admin_solar_branches (name, system_kw) VALUES
  ('Head Office',          33),
  ('Gujranwala',           20),
  ('DHA Y Block (1F)',     13),
  ('DHA Y Block (2F)',     13),
  ('Tariq Road',           18),
  ('Peshawar',             27),
  ('58-L (FIEDMC)',        50),
  ('482-XX',               34)
ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- SEED DATA — IFPL Retail Locations (from PnL parser canonical names)
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO admin_locations (name, entity, location_type, province) VALUES
  ('DHA',                     'IFPL', 'retail', 'Punjab'),
  ('Head Office 62-XX',       'IFPL', 'retail', 'Punjab'),
  ('Head Office 61-XX',       'IFPL', 'retail', 'Punjab'),
  ('Iqbal Town',               'IFPL', 'retail', 'Punjab'),
  ('Packages Mall',            'IFPL', 'retail', 'Punjab'),
  ('LDS Jhang',                'IFPL', 'retail', 'Punjab'),
  ('Mall of Multan',           'IFPL', 'retail', 'Punjab'),
  ('Emporium Mall',            'IFPL', 'retail', 'Punjab'),
  ('Packages Mall Mega Store', 'IFPL', 'retail', 'Punjab'),
  ('Lake City',                'IFPL', 'retail', 'Punjab'),
  ('Gujranwala',               'IFPL', 'retail', 'Punjab'),
  ('Amanah Mall',              'IFPL', 'retail', 'Punjab'),
  ('Liberty Store',            'IFPL', 'retail', 'Punjab'),
  ('Bahria Town',              'IFPL', 'retail', 'Punjab'),
  ('V Mall Sialkot',           'IFPL', 'retail', 'Punjab'),
  ('Sialkot Store',            'IFPL', 'retail', 'Punjab'),
  ('Sahiwal',                  'IFPL', 'retail', 'Punjab'),
  ('Rahim Yar Khan',           'IFPL', 'retail', 'Punjab'),
  ('Phalia Mandi Bahauddin',   'IFPL', 'retail', 'Punjab'),
  ('Hakim Mall',               'IFPL', 'retail', 'Punjab'),
  ('Sufi City',                'IFPL', 'retail', 'Punjab'),
  ('Kharian',                  'IFPL', 'retail', 'Punjab'),
  ('Usman Mall',               'IFPL', 'retail', 'Punjab'),
  ('Hurrianwala',              'IFPL', 'retail', 'Punjab'),
  ('Kooh I Noor',              'IFPL', 'retail', 'Punjab'),
  ('Capital Square',           'IFPL', 'retail', 'Punjab'),
  ('Giga Mall',                'IFPL', 'retail', 'Punjab'),
  ('Faisalabad',               'IFPL', 'retail', 'Punjab'),
  ('Manga Warehouse',          'IFPL', 'warehouse', 'Punjab'),
  ('Warehouse',                'IFPL', 'warehouse', 'Punjab'),
  ('Lucky One Mall',           'IFPL', 'retail', 'Sindh'),
  ('Tariq Road',               'IFPL', 'retail', 'Sindh'),
  ('Dolmen Mall',              'IFPL', 'retail', 'Sindh'),
  ('Hyderabad',                'IFPL', 'retail', 'Sindh'),
  ('Peshawar 1',               'IFPL', 'retail', 'KPK'),
  ('Swat',                     'IFPL', 'retail', 'KPK'),
  ('Mardan',                   'IFPL', 'retail', 'KPK')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- SEED DATA — Restaurant Locations
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO admin_locations (name, entity, location_type, province) VALUES
  ('Raya',             'Baranh',     'restaurant', 'Punjab'),
  ('DHA Y Block',      'Baranh',     'restaurant', 'Punjab'),
  ('Packages Mall',    'Baranh',     'restaurant', 'Punjab'),
  ('Gulberg',          'Baranh',     'restaurant', 'Punjab'),
  ('Jhang',            'Baranh',     'restaurant', 'Punjab'),
  ('Elysian Sweets',   'Baranh',     'restaurant', 'Punjab'),
  ('Restaurant Warehouse', 'Baranh', 'warehouse',  'Punjab'),
  ('Raya',             'HD',         'restaurant', 'Punjab'),
  ('DHA Y Block',      'HD',         'restaurant', 'Punjab'),
  ('Packages Mall',    'HD',         'restaurant', 'Punjab'),
  ('Dolmen Mall',      'HD',         'restaurant', 'Sindh')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- SEED DATA — UTPL Sites
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO admin_locations (name, entity, location_type, province) VALUES
  ('Meter Factory', 'UTPL', 'plant', 'Punjab'),
  ('MEPCO',         'UTPL', 'plant', 'Punjab'),
  ('PESCO',         'UTPL', 'plant', 'KPK'),
  ('FIEDMC',        'UTPL', 'plant', 'Punjab'),
  ('BINC',          'UTPL', 'plant', 'Punjab')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- Auto-populate admin_registrations rows for every location × type
-- so the grid starts fully populated with 'Pending' (admin updates from there)
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO admin_registrations (location_id, registration_type, status)
SELECT id, 'EOBI', 'Pending'
FROM admin_locations
ON CONFLICT (location_id, registration_type) DO NOTHING;

INSERT INTO admin_registrations (location_id, registration_type, status)
SELECT id, 'Social Security', 'Pending'
FROM admin_locations
ON CONFLICT (location_id, registration_type) DO NOTHING;

-- Auto-populate admin_compliance rows for retail/plant locations
INSERT INTO admin_compliance (location_id, compliance_type, status)
SELECT id, c.type, 'Pending'
FROM admin_locations
CROSS JOIN (VALUES
  ('Civil Defence'),
  ('Labour Registration'),
  ('Labour Inspection')
) AS c(type)
WHERE location_type IN ('retail', 'plant', 'warehouse')
ON CONFLICT (location_id, compliance_type) DO NOTHING;

-- Auto-populate restaurant_licences rows for restaurant locations
INSERT INTO admin_restaurant_licences (location_id, licence_type, status)
SELECT id, lt.type, 'Pending'
FROM admin_locations
CROSS JOIN (VALUES
  ('PFA Licence'),
  ('Medical Certificate'),
  ('Training Certificate'),
  ('Tourism Certificate')
) AS lt(type)
WHERE entity IN ('Baranh', 'HD') AND location_type = 'restaurant'
ON CONFLICT (location_id, licence_type) DO NOTHING;
