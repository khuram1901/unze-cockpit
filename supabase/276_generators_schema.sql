-- ============================================================
-- 276_generators_schema.sql
-- Generators feature: master list, diesel fuel log, maintenance log
-- ============================================================

-- ── 1. New locations for unmatched sites ──────────────────────────────
INSERT INTO admin_locations (name) VALUES
  ('482XX - Kamran'),
  ('W210 - Khuram'),
  ('Warehouse Gajumatta'),
  ('Baranh Y-Block'),
  ('Baranh Raya')
ON CONFLICT (name) DO NOTHING;

-- ── 2. generators master table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS generators (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id      uuid REFERENCES admin_locations(id) ON DELETE SET NULL,
  kva              integer        NOT NULL,
  model            text           NOT NULL,    -- e.g. "Cummins", "Perkins", "John Deere", "YD-China"
  label            text,                       -- optional short label e.g. "Gen-61", "Gen-62"
  is_active        boolean        NOT NULL DEFAULT true,
  created_at       timestamptz    NOT NULL DEFAULT now(),
  updated_at       timestamptz    NOT NULL DEFAULT now()
);

-- ── 3. generator_fuel_log ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS generator_fuel_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generator_id        uuid NOT NULL REFERENCES generators(id) ON DELETE CASCADE,
  refuel_date         date NOT NULL,
  previous_hours      numeric(10,1),           -- NULL only for very first entry
  present_hours       numeric(10,1),           -- NULL for historical seed rows
  hours_run           numeric(10,1)
    GENERATED ALWAYS AS (
      CASE WHEN present_hours IS NOT NULL AND previous_hours IS NOT NULL
           THEN present_hours - previous_hours
      END
    ) STORED,
  rate_per_litre      numeric(10,2) NOT NULL,
  qty_litres          numeric(10,2) NOT NULL,
  total_cost          numeric(12,2)
    GENERATED ALWAYS AS (rate_per_litre * qty_litres) STORED,
  litres_per_hour     numeric(10,4)
    GENERATED ALWAYS AS (
      CASE WHEN present_hours IS NOT NULL AND previous_hours IS NOT NULL
                AND present_hours > previous_hours
           THEN qty_litres / NULLIF(present_hours - previous_hours, 0)
      END
    ) STORED,
  cost_per_hour       numeric(12,4)
    GENERATED ALWAYS AS (
      CASE WHEN present_hours IS NOT NULL AND previous_hours IS NOT NULL
                AND present_hours > previous_hours
           THEN (rate_per_litre * qty_litres) / NULLIF(present_hours - previous_hours, 0)
      END
    ) STORED,
  remarks             text,
  is_deleted          boolean NOT NULL DEFAULT false,
  deleted_at          timestamptz,
  deleted_reason      text,
  entered_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ── 4. generator_maintenance_log ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS generator_maintenance_log (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generator_id            uuid NOT NULL REFERENCES generators(id) ON DELETE CASCADE,
  maintenance_date        date NOT NULL,
  engine_oil              numeric(12,2) NOT NULL DEFAULT 0,
  oil_filter              numeric(12,2) NOT NULL DEFAULT 0,
  fuel_filter             numeric(12,2) NOT NULL DEFAULT 0,
  air_filter              numeric(12,2) NOT NULL DEFAULT 0,
  radiator_service        numeric(12,2) NOT NULL DEFAULT 0,
  periodic_maintenance    numeric(12,2) NOT NULL DEFAULT 0,
  other_mechanical_work   numeric(12,2) NOT NULL DEFAULT 0,
  others                  numeric(12,2) NOT NULL DEFAULT 0,
  total_cost              numeric(12,2)
    GENERATED ALWAYS AS (
      engine_oil + oil_filter + fuel_filter + air_filter +
      radiator_service + periodic_maintenance + other_mechanical_work + others
    ) STORED,
  is_deleted              boolean NOT NULL DEFAULT false,
  deleted_at              timestamptz,
  deleted_reason          text,
  entered_by              text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ── 5. Generator alert thresholds (editable by admin) ─────────────────
CREATE TABLE IF NOT EXISTS generator_thresholds (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Fuel theft/leak: flag if litres_per_hour > avg * (1 + pct/100)
  unusual_consumption_pct     integer NOT NULL DEFAULT 30,
  -- Service overdue: flag if hours since last maintenance > threshold
  service_overdue_hours       integer NOT NULL DEFAULT 250,
  -- Days-since-refuel amber/red thresholds
  refuel_amber_days           integer NOT NULL DEFAULT 7,
  refuel_red_days             integer NOT NULL DEFAULT 14,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  text
);
INSERT INTO generator_thresholds (id) VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- ── 6. Audit trail for edits ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS generator_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name  text NOT NULL,
  row_id      uuid NOT NULL,
  action      text NOT NULL,   -- 'UPDATE' | 'DELETE'
  changed_by  text,
  old_data    jsonb,
  new_data    jsonb,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 7. Indexes ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_gen_fuel_generator ON generator_fuel_log(generator_id);
CREATE INDEX IF NOT EXISTS idx_gen_fuel_date ON generator_fuel_log(refuel_date);
CREATE INDEX IF NOT EXISTS idx_gen_fuel_deleted ON generator_fuel_log(is_deleted) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_gen_maint_generator ON generator_maintenance_log(generator_id);
CREATE INDEX IF NOT EXISTS idx_gen_maint_date ON generator_maintenance_log(maintenance_date);
CREATE INDEX IF NOT EXISTS idx_gen_maint_deleted ON generator_maintenance_log(is_deleted) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_generators_location ON generators(location_id);
CREATE INDEX IF NOT EXISTS idx_generators_active ON generators(is_active) WHERE is_active = true;

-- ── 8. Updated_at triggers ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_generators_updated_at') THEN
    CREATE TRIGGER trg_generators_updated_at
      BEFORE UPDATE ON generators
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_gen_fuel_updated_at') THEN
    CREATE TRIGGER trg_gen_fuel_updated_at
      BEFORE UPDATE ON generator_fuel_log
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_gen_maint_updated_at') THEN
    CREATE TRIGGER trg_gen_maint_updated_at
      BEFORE UPDATE ON generator_maintenance_log
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ── 9. RLS ────────────────────────────────────────────────────────────
ALTER TABLE generators               ENABLE ROW LEVEL SECURITY;
ALTER TABLE generator_fuel_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE generator_maintenance_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE generator_thresholds     ENABLE ROW LEVEL SECURITY;
ALTER TABLE generator_audit_log      ENABLE ROW LEVEL SECURITY;

-- Revoke anon
REVOKE ALL ON generators                FROM anon, public;
REVOKE ALL ON generator_fuel_log        FROM anon, public;
REVOKE ALL ON generator_maintenance_log FROM anon, public;
REVOKE ALL ON generator_thresholds      FROM anon, public;
REVOKE ALL ON generator_audit_log       FROM anon, public;

-- generators: read-all for authenticated (needed for dropdowns)
CREATE POLICY "generators_read_authenticated" ON generators
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "generators_write_admin" ON generators
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM members m WHERE lower(m.email) = lower(auth.email())
      AND m.role IN ('CEO','Admin')
  ));

-- fuel log: select for admin_entry users and admins
CREATE POLICY "gen_fuel_select" ON generator_fuel_log
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM members m WHERE lower(m.email) = lower(auth.email())
        AND (m.role IN ('CEO','Admin') OR m.admin_entry = true)
    )
  );

CREATE POLICY "gen_fuel_insert" ON generator_fuel_log
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM members m WHERE lower(m.email) = lower(auth.email())
        AND (m.role IN ('CEO','Admin') OR m.admin_entry = true)
    )
  );

CREATE POLICY "gen_fuel_update_admin" ON generator_fuel_log
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM members m WHERE lower(m.email) = lower(auth.email())
        AND m.role IN ('CEO','Admin')
    )
  );

-- maintenance log: same pattern
CREATE POLICY "gen_maint_select" ON generator_maintenance_log
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM members m WHERE lower(m.email) = lower(auth.email())
        AND (m.role IN ('CEO','Admin') OR m.admin_entry = true)
    )
  );

CREATE POLICY "gen_maint_insert" ON generator_maintenance_log
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM members m WHERE lower(m.email) = lower(auth.email())
        AND (m.role IN ('CEO','Admin') OR m.admin_entry = true)
    )
  );

CREATE POLICY "gen_maint_update_admin" ON generator_maintenance_log
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM members m WHERE lower(m.email) = lower(auth.email())
        AND m.role IN ('CEO','Admin')
    )
  );

-- thresholds: read for authenticated, write for admin
CREATE POLICY "gen_thresh_read" ON generator_thresholds
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "gen_thresh_write" ON generator_thresholds
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM members m WHERE lower(m.email) = lower(auth.email())
        AND m.role IN ('CEO','Admin')
    )
  );

-- audit log: admins only
CREATE POLICY "gen_audit_admin" ON generator_audit_log
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM members m WHERE lower(m.email) = lower(auth.email())
        AND m.role IN ('CEO','Admin')
    )
  );

-- ── ROLLBACK ──────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS generator_audit_log CASCADE;
-- DROP TABLE IF EXISTS generator_thresholds CASCADE;
-- DROP TABLE IF EXISTS generator_maintenance_log CASCADE;
-- DROP TABLE IF EXISTS generator_fuel_log CASCADE;
-- DROP TABLE IF EXISTS generators CASCADE;
-- DELETE FROM admin_locations WHERE name IN ('482XX - Kamran','W210 - Khuram','Warehouse Gajumatta','Baranh Y-Block','Baranh Raya');
