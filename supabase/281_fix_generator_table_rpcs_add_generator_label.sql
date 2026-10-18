-- Migration 281: Fix get_generator_fuel_table() and get_generator_maintenance_table()
-- Problem: Both RPCs return kva/model/label as separate columns but frontend
--          GenFuelRow and GenMaintRow types both expect a generator_label column
-- Fix: Add COALESCE(g.label, g.model || ' ' || g.kva || 'KVA') AS generator_label
--
-- ── ROLLBACK ──────────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.get_generator_fuel_table(uuid, uuid, date, date, text, integer, integer);
-- DROP FUNCTION IF EXISTS public.get_generator_maintenance_table(uuid, uuid, date, date, text, integer, integer);
-- (Restore prior versions from migration 27x)

-- ── FUEL TABLE ────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_generator_fuel_table(uuid, uuid, date, date, text, integer, integer);

CREATE FUNCTION public.get_generator_fuel_table(
  p_location_id  uuid    DEFAULT NULL,
  p_generator_id uuid    DEFAULT NULL,
  p_date_from    date    DEFAULT NULL,
  p_date_to      date    DEFAULT NULL,
  p_search       text    DEFAULT NULL,
  p_limit        integer DEFAULT 100,
  p_offset       integer DEFAULT 0
)
RETURNS TABLE(
  id               uuid,
  generator_label  text,
  location_name    text,
  kva              integer,
  model            text,
  label            text,
  generator_id     uuid,
  refuel_date      date,
  previous_hours   numeric,
  present_hours    numeric,
  hours_run        numeric,
  rate_per_litre   numeric,
  qty_litres       numeric,
  total_cost       numeric,
  litres_per_hour  numeric,
  cost_per_hour    numeric,
  remarks          text,
  entered_by       text,
  is_deleted       boolean,
  deleted_reason   text,
  unusual_flag     boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  WITH gen_avg AS (
    SELECT fl.generator_id,
           AVG(fl.litres_per_hour) AS avg_lph
    FROM generator_fuel_log fl
    WHERE fl.is_deleted = false
      AND fl.litres_per_hour IS NOT NULL
      AND fl.refuel_date >= (CURRENT_DATE - INTERVAL '90 days')
    GROUP BY fl.generator_id
  ),
  thresh AS (
    SELECT unusual_consumption_pct FROM generator_thresholds LIMIT 1
  )
  SELECT
    fl.id,
    COALESCE(g.label, g.model || ' ' || g.kva || 'KVA') AS generator_label,
    al.name                                               AS location_name,
    g.kva,
    g.model,
    g.label,
    g.id                                                  AS generator_id,
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
    CASE
      WHEN ga.avg_lph IS NOT NULL AND fl.litres_per_hour IS NOT NULL
      THEN fl.litres_per_hour > ga.avg_lph * (1 + (th.unusual_consumption_pct::numeric / 100))
      ELSE false
    END AS unusual_flag
  FROM generator_fuel_log fl
  JOIN generators g          ON g.id = fl.generator_id
  JOIN admin_locations al    ON al.id = g.location_id
  LEFT JOIN gen_avg ga       ON ga.generator_id = fl.generator_id
  CROSS JOIN thresh th
  WHERE (p_date_from    IS NULL OR fl.refuel_date   >= p_date_from)
    AND (p_date_to      IS NULL OR fl.refuel_date   <= p_date_to)
    AND (p_location_id  IS NULL OR g.location_id    =  p_location_id)
    AND (p_generator_id IS NULL OR fl.generator_id  =  p_generator_id)
    AND (is_generator_admin() OR fl.is_deleted = false)
    AND (p_search IS NULL OR
         al.name ILIKE '%' || p_search || '%' OR
         g.model ILIKE '%' || p_search || '%' OR
         COALESCE(g.label, '') ILIKE '%' || p_search || '%')
  ORDER BY fl.refuel_date DESC, al.name, g.kva DESC
  LIMIT p_limit OFFSET p_offset;
$fn$;

-- ── MAINTENANCE TABLE ─────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_generator_maintenance_table(uuid, uuid, date, date, text, integer, integer);

CREATE FUNCTION public.get_generator_maintenance_table(
  p_location_id  uuid    DEFAULT NULL,
  p_generator_id uuid    DEFAULT NULL,
  p_date_from    date    DEFAULT NULL,
  p_date_to      date    DEFAULT NULL,
  p_search       text    DEFAULT NULL,
  p_limit        integer DEFAULT 100,
  p_offset       integer DEFAULT 0
)
RETURNS TABLE(
  id                    uuid,
  generator_label       text,
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
  remarks               text,
  entered_by            text,
  is_deleted            boolean,
  deleted_reason        text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn2$
  SELECT
    ml.id,
    COALESCE(g.label, g.model || ' ' || g.kva || 'KVA') AS generator_label,
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
    ml.remarks,
    ml.entered_by,
    ml.is_deleted,
    ml.deleted_reason
  FROM generator_maintenance_log ml
  JOIN generators g ON g.id = ml.generator_id
  JOIN admin_locations al ON al.id = g.location_id
  WHERE (p_date_from    IS NULL OR ml.maintenance_date >= p_date_from)
    AND (p_date_to      IS NULL OR ml.maintenance_date <= p_date_to)
    AND (p_location_id  IS NULL OR g.location_id        = p_location_id)
    AND (p_generator_id IS NULL OR ml.generator_id      = p_generator_id)
    AND (p_search IS NULL OR
         al.name  ILIKE '%' || p_search || '%' OR
         g.model  ILIKE '%' || p_search || '%' OR
         COALESCE(g.label, '') ILIKE '%' || p_search || '%')
    AND (is_generator_admin() OR ml.is_deleted = false)
  ORDER BY ml.maintenance_date DESC, al.name, g.kva DESC
  LIMIT p_limit OFFSET p_offset;
$fn2$;

SELECT 'generator table RPCs updated: generator_label column added to both' AS status;
