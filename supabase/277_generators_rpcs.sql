-- ============================================================
-- 277_generators_rpcs.sql
-- All Postgres RPCs and views for generators feature
-- ============================================================

-- ── Helper: is_generator_admin ────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_generator_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM members m WHERE lower(m.email) = lower(auth.email())
      AND m.role IN ('CEO','Admin')
  );
$$;

-- ── Helper: is_generator_entry_user ───────────────────────────────────
CREATE OR REPLACE FUNCTION is_generator_entry_user()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM members m WHERE lower(m.email) = lower(auth.email())
      AND (m.role IN ('CEO','Admin') OR m.admin_entry = true)
  );
$$;

REVOKE ALL ON FUNCTION is_generator_admin() FROM anon, public;
REVOKE ALL ON FUNCTION is_generator_entry_user() FROM anon, public;

-- ── 1. get_generators_meta ────────────────────────────────────────────
-- Returns locations + their generators for daily-entry dropdowns
CREATE OR REPLACE FUNCTION get_generators_meta()
RETURNS TABLE (
  location_id   uuid,
  location_name text,
  generator_id  uuid,
  kva           integer,
  model         text,
  label         text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    al.id                                         AS location_id,
    al.name                                       AS location_name,
    g.id                                          AS generator_id,
    g.kva,
    g.model,
    g.label
  FROM generators g
  JOIN admin_locations al ON al.id = g.location_id
  WHERE g.is_active = true
  ORDER BY al.name, g.kva DESC;
$$;
REVOKE ALL ON FUNCTION get_generators_meta() FROM anon, public;
GRANT EXECUTE ON FUNCTION get_generators_meta() TO authenticated;

-- ── 2. get_last_generator_refuel ──────────────────────────────────────
CREATE OR REPLACE FUNCTION get_last_generator_refuel(p_generator_id uuid)
RETURNS TABLE (
  previous_hours  numeric,
  present_hours   numeric,
  refuel_date     date,
  is_seed         boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    fl.previous_hours,
    fl.present_hours,
    fl.refuel_date,
    (fl.present_hours IS NULL) AS is_seed
  FROM generator_fuel_log fl
  WHERE fl.generator_id = p_generator_id
    AND fl.is_deleted = false
  ORDER BY fl.refuel_date DESC, fl.created_at DESC
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION get_last_generator_refuel(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION get_last_generator_refuel(uuid) TO authenticated;

-- ── 3. insert_generator_fuel ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION insert_generator_fuel(
  p_generator_id    uuid,
  p_refuel_date     date,
  p_previous_hours  numeric,
  p_present_hours   numeric,
  p_rate_per_litre  numeric,
  p_qty_litres      numeric,
  p_remarks         text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_allowed boolean;
BEGIN
  SELECT is_generator_entry_user() INTO v_allowed;
  IF NOT v_allowed THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_present_hours IS NOT NULL AND p_previous_hours IS NOT NULL
     AND p_present_hours < p_previous_hours THEN
    RAISE EXCEPTION 'Present hours must be ≥ previous hours';
  END IF;
  INSERT INTO generator_fuel_log (
    generator_id, refuel_date, previous_hours, present_hours,
    rate_per_litre, qty_litres, remarks, entered_by
  ) VALUES (
    p_generator_id, p_refuel_date, p_previous_hours, p_present_hours,
    p_rate_per_litre, p_qty_litres, p_remarks, auth.email()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION insert_generator_fuel(uuid,date,numeric,numeric,numeric,numeric,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION insert_generator_fuel(uuid,date,numeric,numeric,numeric,numeric,text) TO authenticated;

-- ── 4. insert_generator_maintenance ──────────────────────────────────
CREATE OR REPLACE FUNCTION insert_generator_maintenance(
  p_generator_id          uuid,
  p_maintenance_date      date,
  p_engine_oil            numeric DEFAULT 0,
  p_oil_filter            numeric DEFAULT 0,
  p_fuel_filter           numeric DEFAULT 0,
  p_air_filter            numeric DEFAULT 0,
  p_radiator_service      numeric DEFAULT 0,
  p_periodic_maintenance  numeric DEFAULT 0,
  p_other_mechanical_work numeric DEFAULT 0,
  p_others                numeric DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_allowed boolean;
BEGIN
  SELECT is_generator_entry_user() INTO v_allowed;
  IF NOT v_allowed THEN RAISE EXCEPTION 'Access denied'; END IF;
  INSERT INTO generator_maintenance_log (
    generator_id, maintenance_date,
    engine_oil, oil_filter, fuel_filter, air_filter,
    radiator_service, periodic_maintenance, other_mechanical_work, others,
    entered_by
  ) VALUES (
    p_generator_id, p_maintenance_date,
    p_engine_oil, p_oil_filter, p_fuel_filter, p_air_filter,
    p_radiator_service, p_periodic_maintenance, p_other_mechanical_work, p_others,
    auth.email()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION insert_generator_maintenance(uuid,date,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) FROM anon, public;
GRANT EXECUTE ON FUNCTION insert_generator_maintenance(uuid,date,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) TO authenticated;

-- ── 5. get_generator_fuel_table (admin) ──────────────────────────────
CREATE OR REPLACE FUNCTION get_generator_fuel_table(
  p_date_from    date DEFAULT NULL,
  p_date_to      date DEFAULT NULL,
  p_location_id  uuid DEFAULT NULL,
  p_generator_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id              uuid,
  location_name   text,
  kva             integer,
  model           text,
  label           text,
  generator_id    uuid,
  refuel_date     date,
  previous_hours  numeric,
  present_hours   numeric,
  hours_run       numeric,
  rate_per_litre  numeric,
  qty_litres      numeric,
  total_cost      numeric,
  litres_per_hour numeric,
  cost_per_hour   numeric,
  remarks         text,
  entered_by      text,
  is_deleted      boolean,
  deleted_reason  text,
  unusual_flag    boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  WITH gen_avg AS (
    SELECT
      fl.generator_id,
      AVG(fl.litres_per_hour) AS avg_lph
    FROM generator_fuel_log fl
    WHERE fl.is_deleted = false AND fl.litres_per_hour IS NOT NULL
      AND fl.refuel_date >= (CURRENT_DATE - INTERVAL '90 days')
    GROUP BY fl.generator_id
  ),
  thresh AS (
    SELECT unusual_consumption_pct FROM generator_thresholds LIMIT 1
  )
  SELECT
    fl.id,
    al.name                                       AS location_name,
    g.kva,
    g.model,
    g.label,
    g.id                                          AS generator_id,
    fl.refuel_date,
    fl.previous_hours,
    fl.present_hours,
    fl.hours_run,
    fl.rate_per_litre,
    fl.qty_litres,
    fl.total_cost,
    fl.litres_per_hour,
    fl.cost_per_hour,
    fl.remarks,
    fl.entered_by,
    fl.is_deleted,
    fl.deleted_reason,
    -- Unusual consumption flag
    CASE WHEN ga.avg_lph IS NOT NULL AND fl.litres_per_hour IS NOT NULL
         THEN fl.litres_per_hour > ga.avg_lph * (1 + (th.unusual_consumption_pct::numeric / 100))
         ELSE false
    END                                           AS unusual_flag
  FROM generator_fuel_log fl
  JOIN generators g ON g.id = fl.generator_id
  JOIN admin_locations al ON al.id = g.location_id
  LEFT JOIN gen_avg ga ON ga.generator_id = fl.generator_id
  CROSS JOIN thresh th
  WHERE (p_date_from IS NULL OR fl.refuel_date >= p_date_from)
    AND (p_date_to   IS NULL OR fl.refuel_date <= p_date_to)
    AND (p_location_id  IS NULL OR g.location_id = p_location_id)
    AND (p_generator_id IS NULL OR fl.generator_id = p_generator_id)
    AND (is_generator_admin() OR fl.is_deleted = false)
  ORDER BY fl.refuel_date DESC, al.name, g.kva DESC;
$$;
REVOKE ALL ON FUNCTION get_generator_fuel_table(date,date,uuid,uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION get_generator_fuel_table(date,date,uuid,uuid) TO authenticated;

-- ── 6. get_generator_maintenance_table (admin) ───────────────────────
CREATE OR REPLACE FUNCTION get_generator_maintenance_table(
  p_date_from    date DEFAULT NULL,
  p_date_to      date DEFAULT NULL,
  p_location_id  uuid DEFAULT NULL,
  p_generator_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id                    uuid,
  location_name         text,
  kva                   integer,
  model                 text,
  label                 text,
  generator_id          uuid,
  maintenance_date      date,
  engine_oil            numeric,
  oil_filter            numeric,
  fuel_filter           numeric,
  air_filter            numeric,
  radiator_service      numeric,
  periodic_maintenance  numeric,
  other_mechanical_work numeric,
  others                numeric,
  total_cost            numeric,
  entered_by            text,
  is_deleted            boolean,
  deleted_reason        text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    ml.id,
    al.name          AS location_name,
    g.kva,
    g.model,
    g.label,
    g.id             AS generator_id,
    ml.maintenance_date,
    ml.engine_oil,
    ml.oil_filter,
    ml.fuel_filter,
    ml.air_filter,
    ml.radiator_service,
    ml.periodic_maintenance,
    ml.other_mechanical_work,
    ml.others,
    ml.total_cost,
    ml.entered_by,
    ml.is_deleted,
    ml.deleted_reason
  FROM generator_maintenance_log ml
  JOIN generators g ON g.id = ml.generator_id
  JOIN admin_locations al ON al.id = g.location_id
  WHERE (p_date_from IS NULL OR ml.maintenance_date >= p_date_from)
    AND (p_date_to   IS NULL OR ml.maintenance_date <= p_date_to)
    AND (p_location_id  IS NULL OR g.location_id = p_location_id)
    AND (p_generator_id IS NULL OR ml.generator_id = p_generator_id)
    AND (is_generator_admin() OR ml.is_deleted = false)
  ORDER BY ml.maintenance_date DESC, al.name, g.kva DESC;
$$;
REVOKE ALL ON FUNCTION get_generator_maintenance_table(date,date,uuid,uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION get_generator_maintenance_table(date,date,uuid,uuid) TO authenticated;

-- ── 7. get_generator_summary ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_generator_summary()
RETURNS TABLE (
  generator_id          uuid,
  location_name         text,
  kva                   integer,
  model                 text,
  label                 text,
  -- This month fuel
  fuel_litres_month     numeric,
  fuel_cost_month       numeric,
  -- Overall
  avg_litres_per_hour   numeric,
  avg_cost_per_hour     numeric,
  -- Last refuel
  last_refuel_date      date,
  days_since_refuel     integer,
  refuel_rag            text,    -- 'green' | 'amber' | 'red'
  -- Last maintenance
  last_maintenance_date date,
  hours_since_maint     numeric,
  service_overdue       boolean,
  -- Unusual consumption flag (last entry)
  unusual_flag          boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  WITH thresh AS (
    SELECT unusual_consumption_pct, service_overdue_hours,
           refuel_amber_days, refuel_red_days
    FROM generator_thresholds LIMIT 1
  ),
  month_fuel AS (
    SELECT
      fl.generator_id,
      SUM(fl.qty_litres)  AS litres,
      SUM(fl.total_cost)  AS cost
    FROM generator_fuel_log fl
    WHERE fl.is_deleted = false
      AND fl.refuel_date >= date_trunc('month', CURRENT_DATE)
    GROUP BY fl.generator_id
  ),
  overall_avg AS (
    SELECT
      fl.generator_id,
      AVG(fl.litres_per_hour) AS avg_lph,
      AVG(fl.cost_per_hour)   AS avg_cph
    FROM generator_fuel_log fl
    WHERE fl.is_deleted = false AND fl.litres_per_hour IS NOT NULL
    GROUP BY fl.generator_id
  ),
  last_refuel AS (
    SELECT DISTINCT ON (fl.generator_id)
      fl.generator_id,
      fl.refuel_date,
      fl.litres_per_hour AS last_lph
    FROM generator_fuel_log fl
    WHERE fl.is_deleted = false
    ORDER BY fl.generator_id, fl.refuel_date DESC
  ),
  last_maint AS (
    SELECT DISTINCT ON (ml.generator_id)
      ml.generator_id,
      ml.maintenance_date
    FROM generator_maintenance_log ml
    WHERE ml.is_deleted = false
    ORDER BY ml.generator_id, ml.maintenance_date DESC
  ),
  last_hours AS (
    -- Most recent present_hours reading for service-overdue calc
    SELECT DISTINCT ON (fl.generator_id)
      fl.generator_id,
      fl.present_hours
    FROM generator_fuel_log fl
    WHERE fl.is_deleted = false AND fl.present_hours IS NOT NULL
    ORDER BY fl.generator_id, fl.refuel_date DESC
  ),
  maint_hours AS (
    -- present_hours at last maintenance date
    SELECT DISTINCT ON (fl.generator_id)
      fl.generator_id,
      fl.present_hours AS maint_hours
    FROM generator_fuel_log fl
    JOIN last_maint lm ON lm.generator_id = fl.generator_id
    WHERE fl.is_deleted = false AND fl.present_hours IS NOT NULL
      AND fl.refuel_date <= lm.maintenance_date
    ORDER BY fl.generator_id, fl.refuel_date DESC
  )
  SELECT
    g.id                                          AS generator_id,
    al.name                                       AS location_name,
    g.kva,
    g.model,
    g.label,
    COALESCE(mf.litres, 0)                        AS fuel_litres_month,
    COALESCE(mf.cost, 0)                          AS fuel_cost_month,
    oa.avg_lph                                    AS avg_litres_per_hour,
    oa.avg_cph                                    AS avg_cost_per_hour,
    lr.refuel_date                                AS last_refuel_date,
    (CURRENT_DATE - lr.refuel_date)::integer      AS days_since_refuel,
    CASE
      WHEN lr.refuel_date IS NULL THEN 'red'
      WHEN (CURRENT_DATE - lr.refuel_date) >= th.refuel_red_days   THEN 'red'
      WHEN (CURRENT_DATE - lr.refuel_date) >= th.refuel_amber_days THEN 'amber'
      ELSE 'green'
    END                                           AS refuel_rag,
    lm.maintenance_date                           AS last_maintenance_date,
    CASE WHEN lh.present_hours IS NOT NULL AND mh.maint_hours IS NOT NULL
         THEN lh.present_hours - mh.maint_hours
    END                                           AS hours_since_maint,
    CASE WHEN lh.present_hours IS NOT NULL AND mh.maint_hours IS NOT NULL
         THEN (lh.present_hours - mh.maint_hours) >= th.service_overdue_hours
         ELSE false
    END                                           AS service_overdue,
    CASE WHEN oa.avg_lph IS NOT NULL AND lr.last_lph IS NOT NULL
         THEN lr.last_lph > oa.avg_lph * (1 + (th.unusual_consumption_pct::numeric / 100))
         ELSE false
    END                                           AS unusual_flag
  FROM generators g
  JOIN admin_locations al ON al.id = g.location_id
  CROSS JOIN thresh th
  LEFT JOIN month_fuel mf ON mf.generator_id = g.id
  LEFT JOIN overall_avg oa ON oa.generator_id = g.id
  LEFT JOIN last_refuel lr ON lr.generator_id = g.id
  LEFT JOIN last_maint lm ON lm.generator_id = g.id
  LEFT JOIN last_hours lh ON lh.generator_id = g.id
  LEFT JOIN maint_hours mh ON mh.generator_id = g.id
  WHERE g.is_active = true
  ORDER BY al.name, g.kva DESC;
$$;
REVOKE ALL ON FUNCTION get_generator_summary() FROM anon, public;
GRANT EXECUTE ON FUNCTION get_generator_summary() TO authenticated;

-- ── 8. get_generator_maintenance_by_category ─────────────────────────
CREATE OR REPLACE FUNCTION get_generator_maintenance_by_category(
  p_date_from date DEFAULT NULL,
  p_date_to   date DEFAULT NULL
)
RETURNS TABLE (
  category  text,
  total_cost numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT category, SUM(amt) AS total_cost FROM (
    SELECT 'Engine Oil'             AS category, SUM(engine_oil)             AS amt FROM generator_maintenance_log WHERE is_deleted=false AND (p_date_from IS NULL OR maintenance_date>=p_date_from) AND (p_date_to IS NULL OR maintenance_date<=p_date_to)
    UNION ALL
    SELECT 'Oil Filter',                         SUM(oil_filter)             FROM generator_maintenance_log WHERE is_deleted=false AND (p_date_from IS NULL OR maintenance_date>=p_date_from) AND (p_date_to IS NULL OR maintenance_date<=p_date_to)
    UNION ALL
    SELECT 'Fuel Filter',                        SUM(fuel_filter)            FROM generator_maintenance_log WHERE is_deleted=false AND (p_date_from IS NULL OR maintenance_date>=p_date_from) AND (p_date_to IS NULL OR maintenance_date<=p_date_to)
    UNION ALL
    SELECT 'Air Filter',                         SUM(air_filter)             FROM generator_maintenance_log WHERE is_deleted=false AND (p_date_from IS NULL OR maintenance_date>=p_date_from) AND (p_date_to IS NULL OR maintenance_date<=p_date_to)
    UNION ALL
    SELECT 'Radiator Service',                   SUM(radiator_service)       FROM generator_maintenance_log WHERE is_deleted=false AND (p_date_from IS NULL OR maintenance_date>=p_date_from) AND (p_date_to IS NULL OR maintenance_date<=p_date_to)
    UNION ALL
    SELECT 'Periodic Maintenance',               SUM(periodic_maintenance)   FROM generator_maintenance_log WHERE is_deleted=false AND (p_date_from IS NULL OR maintenance_date>=p_date_from) AND (p_date_to IS NULL OR maintenance_date<=p_date_to)
    UNION ALL
    SELECT 'Other Mechanical Work',              SUM(other_mechanical_work)  FROM generator_maintenance_log WHERE is_deleted=false AND (p_date_from IS NULL OR maintenance_date>=p_date_from) AND (p_date_to IS NULL OR maintenance_date<=p_date_to)
    UNION ALL
    SELECT 'Others',                             SUM(others)                 FROM generator_maintenance_log WHERE is_deleted=false AND (p_date_from IS NULL OR maintenance_date>=p_date_from) AND (p_date_to IS NULL OR maintenance_date<=p_date_to)
  ) cats
  WHERE amt > 0
  GROUP BY category
  ORDER BY total_cost DESC;
$$;
REVOKE ALL ON FUNCTION get_generator_maintenance_by_category(date,date) FROM anon, public;
GRANT EXECUTE ON FUNCTION get_generator_maintenance_by_category(date,date) TO authenticated;

-- ── 9. soft_delete_generator_fuel ────────────────────────────────────
CREATE OR REPLACE FUNCTION soft_delete_generator_fuel(
  p_id      uuid,
  p_reason  text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_old jsonb;
BEGIN
  IF NOT is_generator_admin() THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT to_jsonb(fl) INTO v_old FROM generator_fuel_log fl WHERE fl.id = p_id;
  UPDATE generator_fuel_log SET
    is_deleted = true, deleted_at = now(), deleted_reason = p_reason, updated_at = now()
  WHERE id = p_id;
  INSERT INTO generator_audit_log (table_name, row_id, action, changed_by, old_data)
  VALUES ('generator_fuel_log', p_id, 'DELETE', auth.email(), v_old);
END;
$$;
REVOKE ALL ON FUNCTION soft_delete_generator_fuel(uuid,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION soft_delete_generator_fuel(uuid,text) TO authenticated;

-- ── 10. soft_delete_generator_maintenance ────────────────────────────
CREATE OR REPLACE FUNCTION soft_delete_generator_maintenance(
  p_id      uuid,
  p_reason  text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_old jsonb;
BEGIN
  IF NOT is_generator_admin() THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT to_jsonb(ml) INTO v_old FROM generator_maintenance_log ml WHERE ml.id = p_id;
  UPDATE generator_maintenance_log SET
    is_deleted = true, deleted_at = now(), deleted_reason = p_reason, updated_at = now()
  WHERE id = p_id;
  INSERT INTO generator_audit_log (table_name, row_id, action, changed_by, old_data)
  VALUES ('generator_maintenance_log', p_id, 'DELETE', auth.email(), v_old);
END;
$$;
REVOKE ALL ON FUNCTION soft_delete_generator_maintenance(uuid,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION soft_delete_generator_maintenance(uuid,text) TO authenticated;

-- ── 11. update_generator_fuel ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_generator_fuel(
  p_id             uuid,
  p_refuel_date    date,
  p_previous_hours numeric,
  p_present_hours  numeric,
  p_rate_per_litre numeric,
  p_qty_litres     numeric,
  p_remarks        text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF NOT is_generator_admin() THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT to_jsonb(fl) INTO v_old FROM generator_fuel_log fl WHERE fl.id = p_id;
  UPDATE generator_fuel_log SET
    refuel_date = p_refuel_date,
    previous_hours = p_previous_hours,
    present_hours = p_present_hours,
    rate_per_litre = p_rate_per_litre,
    qty_litres = p_qty_litres,
    remarks = p_remarks,
    updated_at = now()
  WHERE id = p_id;
  SELECT to_jsonb(fl) INTO v_new FROM generator_fuel_log fl WHERE fl.id = p_id;
  INSERT INTO generator_audit_log (table_name, row_id, action, changed_by, old_data, new_data)
  VALUES ('generator_fuel_log', p_id, 'UPDATE', auth.email(), v_old, v_new);
END;
$$;
REVOKE ALL ON FUNCTION update_generator_fuel(uuid,date,numeric,numeric,numeric,numeric,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION update_generator_fuel(uuid,date,numeric,numeric,numeric,numeric,text) TO authenticated;

-- ── 12. update_generator_thresholds ──────────────────────────────────
CREATE OR REPLACE FUNCTION update_generator_thresholds(
  p_unusual_pct       integer,
  p_service_hours     integer,
  p_amber_days        integer,
  p_red_days          integer
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NOT is_generator_admin() THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE generator_thresholds SET
    unusual_consumption_pct = p_unusual_pct,
    service_overdue_hours   = p_service_hours,
    refuel_amber_days       = p_amber_days,
    refuel_red_days         = p_red_days,
    updated_at              = now(),
    updated_by              = auth.email()
  WHERE id = '00000000-0000-0000-0000-000000000001';
END;
$$;
REVOKE ALL ON FUNCTION update_generator_thresholds(integer,integer,integer,integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION update_generator_thresholds(integer,integer,integer,integer) TO authenticated;

-- ── 13. CRUD for generator master ─────────────────────────────────────
CREATE OR REPLACE FUNCTION upsert_generator(
  p_id          uuid DEFAULT NULL,
  p_location_id uuid DEFAULT NULL,
  p_kva         integer DEFAULT NULL,
  p_model       text DEFAULT NULL,
  p_label       text DEFAULT NULL,
  p_is_active   boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT is_generator_admin() THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_id IS NOT NULL THEN
    UPDATE generators SET
      location_id = p_location_id, kva = p_kva, model = p_model,
      label = p_label, is_active = p_is_active, updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO generators (location_id, kva, model, label, is_active)
    VALUES (p_location_id, p_kva, p_model, p_label, p_is_active)
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION upsert_generator(uuid,uuid,integer,text,text,boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION upsert_generator(uuid,uuid,integer,text,text,boolean) TO authenticated;

-- ── ROLLBACK ──────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS upsert_generator(uuid,uuid,integer,text,text,boolean);
-- DROP FUNCTION IF EXISTS update_generator_thresholds(integer,integer,integer,integer);
-- DROP FUNCTION IF EXISTS update_generator_fuel(uuid,date,numeric,numeric,numeric,numeric,text);
-- DROP FUNCTION IF EXISTS soft_delete_generator_maintenance(uuid,text);
-- DROP FUNCTION IF EXISTS soft_delete_generator_fuel(uuid,text);
-- DROP FUNCTION IF EXISTS get_generator_maintenance_by_category(date,date);
-- DROP FUNCTION IF EXISTS get_generator_summary();
-- DROP FUNCTION IF EXISTS get_generator_maintenance_table(date,date,uuid,uuid);
-- DROP FUNCTION IF EXISTS get_generator_fuel_table(date,date,uuid,uuid);
-- DROP FUNCTION IF EXISTS insert_generator_maintenance(uuid,date,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric);
-- DROP FUNCTION IF EXISTS insert_generator_fuel(uuid,date,numeric,numeric,numeric,numeric,text);
-- DROP FUNCTION IF EXISTS get_last_generator_refuel(uuid);
-- DROP FUNCTION IF EXISTS get_generators_meta();
-- DROP FUNCTION IF EXISTS is_generator_entry_user();
-- DROP FUNCTION IF EXISTS is_generator_admin();
