-- ============================================================
-- 280_generator_analytics.sql
-- Per-location generator analytics RPC for the Analytics tab
-- Returns one row per location with fuel, maintenance, and
-- efficiency metrics aggregated in Postgres (never in JS).
-- ============================================================

CREATE OR REPLACE FUNCTION get_generator_analytics(
  p_date_from  date DEFAULT NULL,
  p_date_to    date DEFAULT NULL
)
RETURNS TABLE (
  location_id        uuid,
  location_name      text,
  generator_count    integer,
  -- Fuel
  total_litres       numeric,
  total_fuel_cost    numeric,
  total_hours_run    numeric,
  avg_litres_per_hr  numeric,
  avg_cost_per_hr    numeric,
  -- Maintenance
  total_maint_cost   numeric,
  maint_event_count  integer,
  -- Share % (fleet totals calculated inside the CTE)
  fuel_share_pct     numeric,
  maint_share_pct    numeric,
  -- Cost efficiency score: lower PKR/hr = more efficient
  -- Rank 1 = best (lowest cost/hr)
  efficiency_rank    integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  WITH fuel_by_loc AS (
    SELECT
      g.location_id,
      SUM(fl.qty_litres)                         AS total_litres,
      SUM(fl.total_cost)                         AS total_fuel_cost,
      SUM(fl.hours_run)                          AS total_hours_run,
      AVG(fl.litres_per_hour)                    AS avg_litres_per_hr,
      AVG(fl.cost_per_hour)                      AS avg_cost_per_hr
    FROM generator_fuel_log fl
    JOIN generators g ON g.id = fl.generator_id
    WHERE fl.is_deleted = false
      AND (p_date_from IS NULL OR fl.refuel_date >= p_date_from)
      AND (p_date_to   IS NULL OR fl.refuel_date <= p_date_to)
    GROUP BY g.location_id
  ),
  maint_by_loc AS (
    SELECT
      g.location_id,
      SUM(ml.total_cost)                         AS total_maint_cost,
      COUNT(*)::integer                          AS maint_event_count
    FROM generator_maintenance_log ml
    JOIN generators g ON g.id = ml.generator_id
    WHERE ml.is_deleted = false
      AND (p_date_from IS NULL OR ml.maintenance_date >= p_date_from)
      AND (p_date_to   IS NULL OR ml.maintenance_date <= p_date_to)
    GROUP BY g.location_id
  ),
  gen_count AS (
    SELECT location_id, COUNT(*)::integer AS generator_count
    FROM generators
    WHERE is_active = true
    GROUP BY location_id
  ),
  fleet_totals AS (
    SELECT
      SUM(total_litres)    AS fleet_litres,
      SUM(total_fuel_cost) AS fleet_fuel_cost
    FROM fuel_by_loc
  ),
  maint_totals AS (
    SELECT SUM(total_maint_cost) AS fleet_maint_cost FROM maint_by_loc
  ),
  combined AS (
    SELECT
      al.id                                      AS location_id,
      al.name                                    AS location_name,
      COALESCE(gc.generator_count, 0)            AS generator_count,
      COALESCE(fb.total_litres,    0)            AS total_litres,
      COALESCE(fb.total_fuel_cost, 0)            AS total_fuel_cost,
      COALESCE(fb.total_hours_run, 0)            AS total_hours_run,
      fb.avg_litres_per_hr,
      fb.avg_cost_per_hr,
      COALESCE(mb.total_maint_cost,  0)          AS total_maint_cost,
      COALESCE(mb.maint_event_count, 0)          AS maint_event_count,
      ft.fleet_fuel_cost,
      mt.fleet_maint_cost
    FROM admin_locations al
    JOIN generators g ON g.location_id = al.id AND g.is_active = true
    LEFT JOIN fuel_by_loc  fb ON fb.location_id  = al.id
    LEFT JOIN maint_by_loc mb ON mb.location_id  = al.id
    LEFT JOIN gen_count    gc ON gc.location_id  = al.id
    CROSS JOIN fleet_totals ft
    CROSS JOIN maint_totals mt
    GROUP BY al.id, al.name, gc.generator_count,
             fb.total_litres, fb.total_fuel_cost, fb.total_hours_run,
             fb.avg_litres_per_hr, fb.avg_cost_per_hr,
             mb.total_maint_cost, mb.maint_event_count,
             ft.fleet_fuel_cost, mt.fleet_maint_cost
  )
  SELECT
    c.location_id,
    c.location_name,
    c.generator_count,
    c.total_litres,
    c.total_fuel_cost,
    c.total_hours_run,
    ROUND(c.avg_litres_per_hr, 3)              AS avg_litres_per_hr,
    ROUND(c.avg_cost_per_hr,   2)              AS avg_cost_per_hr,
    c.total_maint_cost,
    c.maint_event_count,
    CASE WHEN COALESCE(c.fleet_fuel_cost, 0) > 0
         THEN ROUND(c.total_fuel_cost / c.fleet_fuel_cost * 100, 1)
         ELSE 0
    END                                        AS fuel_share_pct,
    CASE WHEN COALESCE(c.fleet_maint_cost, 0) > 0
         THEN ROUND(c.total_maint_cost / c.fleet_maint_cost * 100, 1)
         ELSE 0
    END                                        AS maint_share_pct,
    RANK() OVER (
      ORDER BY COALESCE(c.avg_cost_per_hr, 999999) ASC
    )::integer                                 AS efficiency_rank
  FROM combined c
  ORDER BY efficiency_rank, c.location_name;
$$;

REVOKE ALL ON FUNCTION get_generator_analytics(date, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION get_generator_analytics(date, date) TO authenticated;

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS get_generator_analytics(date, date);
