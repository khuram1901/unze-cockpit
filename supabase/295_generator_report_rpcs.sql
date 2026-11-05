-- Migration 295: Generator report RPCs
-- get_generator_report_fleet  → per-generator fleet ranking with date range
-- get_generator_history       → full fuel + maintenance combined log for one generator

-- ── 1. Per-generator fleet report ─────────────────────────────────────────────
-- Returns one row per generator with aggregated stats for the given date range.
-- Equivalent to what get_generator_summary does but date-scoped and with totals.
CREATE OR REPLACE FUNCTION public.get_generator_report_fleet(
  p_date_from date DEFAULT NULL,
  p_date_to   date DEFAULT NULL
)
RETURNS TABLE (
  generator_id        uuid,
  generator_label     text,
  location_name       text,
  kva                 integer,
  model               text,
  total_refuels       bigint,
  total_litres        numeric,
  total_fuel_cost     numeric,
  total_hours_run     numeric,
  avg_litres_per_hour numeric,
  avg_cost_per_hour   numeric,
  total_maint_cost    numeric,
  maint_event_count   bigint,
  total_cost          numeric,
  last_refuel_date    date,
  last_service_date   date,
  -- monthly breakdown (4 months)
  m1_fuel             numeric,
  m2_fuel             numeric,
  m3_fuel             numeric,
  m4_fuel             numeric,
  m1_label            text,
  m2_label            text,
  m3_label            text,
  m4_label            text
)
LANGUAGE sql
STABLE SECURITY DEFINER SET search_path = public
AS $$
WITH
  date_range AS (
    SELECT
      COALESCE(p_date_from, (date_trunc('month', CURRENT_DATE) - interval '3 months')::date) AS d_from,
      COALESCE(p_date_to,   (CURRENT_DATE))                                                   AS d_to
  ),
  -- compute up to 4 months within the range
  months AS (
    SELECT
      generate_series(
        date_trunc('month', (SELECT d_from FROM date_range)),
        date_trunc('month', (SELECT d_to   FROM date_range)),
        interval '1 month'
      )::date AS month_start
    LIMIT 4
  ),
  month_list AS (
    SELECT
      month_start,
      to_char(month_start, 'Mon') AS month_label,
      row_number() OVER (ORDER BY month_start) AS rn
    FROM months
  ),
  fuel_agg AS (
    SELECT
      fl.generator_id,
      COUNT(*)                   AS total_refuels,
      SUM(fl.qty_litres)         AS total_litres,
      SUM(fl.total_cost)         AS total_fuel_cost,
      SUM(fl.hours_run)          AS total_hours_run,
      AVG(fl.litres_per_hour)    AS avg_lph,
      AVG(fl.cost_per_hour)      AS avg_cph,
      MAX(fl.refuel_date)        AS last_refuel_date
    FROM generator_fuel_log fl
    CROSS JOIN date_range dr
    WHERE fl.is_deleted = false
      AND fl.refuel_date >= dr.d_from
      AND fl.refuel_date <= dr.d_to
    GROUP BY fl.generator_id
  ),
  maint_agg AS (
    SELECT
      ml.generator_id,
      SUM(ml.total_cost)         AS total_maint_cost,
      COUNT(*)                   AS maint_event_count,
      MAX(ml.maintenance_date)   AS last_service_date
    FROM generator_maintenance_log ml
    CROSS JOIN date_range dr
    WHERE ml.is_deleted = false
      AND ml.maintenance_date >= dr.d_from
      AND ml.maintenance_date <= dr.d_to
    GROUP BY ml.generator_id
  ),
  -- monthly fuel per generator (up to 4 months)
  monthly_fuel AS (
    SELECT
      fl.generator_id,
      date_trunc('month', fl.refuel_date)::date AS month_start,
      SUM(fl.total_cost) AS month_fuel_cost
    FROM generator_fuel_log fl
    CROSS JOIN date_range dr
    WHERE fl.is_deleted = false
      AND fl.refuel_date >= dr.d_from
      AND fl.refuel_date <= dr.d_to
    GROUP BY fl.generator_id, date_trunc('month', fl.refuel_date)
  ),
  monthly_pivot AS (
    SELECT
      mf.generator_id,
      SUM(CASE WHEN ml.rn = 1 THEN mf.month_fuel_cost ELSE 0 END) AS m1,
      SUM(CASE WHEN ml.rn = 2 THEN mf.month_fuel_cost ELSE 0 END) AS m2,
      SUM(CASE WHEN ml.rn = 3 THEN mf.month_fuel_cost ELSE 0 END) AS m3,
      SUM(CASE WHEN ml.rn = 4 THEN mf.month_fuel_cost ELSE 0 END) AS m4
    FROM monthly_fuel mf
    JOIN month_list ml ON ml.month_start = mf.month_start
    GROUP BY mf.generator_id
  )
SELECT
  g.id                                                AS generator_id,
  COALESCE(g.label, g.model || ' ' || g.kva || ' kVA') AS generator_label,
  al.name                                             AS location_name,
  g.kva,
  g.model,
  COALESCE(fa.total_refuels,      0)                  AS total_refuels,
  COALESCE(fa.total_litres,       0)                  AS total_litres,
  COALESCE(fa.total_fuel_cost,    0)                  AS total_fuel_cost,
  COALESCE(fa.total_hours_run,    0)                  AS total_hours_run,
  ROUND(COALESCE(fa.avg_lph,      0), 2)              AS avg_litres_per_hour,
  ROUND(COALESCE(fa.avg_cph,      0), 0)              AS avg_cost_per_hour,
  COALESCE(ma.total_maint_cost,   0)                  AS total_maint_cost,
  COALESCE(ma.maint_event_count,  0)                  AS maint_event_count,
  COALESCE(fa.total_fuel_cost, 0) + COALESCE(ma.total_maint_cost, 0) AS total_cost,
  fa.last_refuel_date,
  ma.last_service_date,
  COALESCE(mp.m1, 0)                                  AS m1_fuel,
  COALESCE(mp.m2, 0)                                  AS m2_fuel,
  COALESCE(mp.m3, 0)                                  AS m3_fuel,
  COALESCE(mp.m4, 0)                                  AS m4_fuel,
  (SELECT month_label FROM month_list WHERE rn = 1)   AS m1_label,
  (SELECT month_label FROM month_list WHERE rn = 2)   AS m2_label,
  (SELECT month_label FROM month_list WHERE rn = 3)   AS m3_label,
  (SELECT month_label FROM month_list WHERE rn = 4)   AS m4_label
FROM generators g
JOIN admin_locations al ON al.id = g.location_id
LEFT JOIN fuel_agg    fa ON fa.generator_id = g.id
LEFT JOIN maint_agg   ma ON ma.generator_id = g.id
LEFT JOIN monthly_pivot mp ON mp.generator_id = g.id
WHERE g.is_active = true
  -- only include generators that have at least some fuel or maint data in range
  AND (fa.generator_id IS NOT NULL OR ma.generator_id IS NOT NULL)
ORDER BY COALESCE(fa.avg_cph, 999999) ASC, al.name;
$$;

REVOKE ALL ON FUNCTION public.get_generator_report_fleet(date, date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_generator_report_fleet(date, date) TO authenticated;


-- ── 2. Per-generator full history (fuel + maintenance combined) ────────────────
-- Returns all events for one generator in the date range, sorted newest first.
CREATE OR REPLACE FUNCTION public.get_generator_history(
  p_generator_id uuid,
  p_date_from    date DEFAULT NULL,
  p_date_to      date DEFAULT NULL
)
RETURNS TABLE (
  event_id        uuid,
  event_type      text,   -- 'fuel' | 'maintenance'
  event_date      date,
  -- fuel columns (null for maintenance rows)
  qty_litres      numeric,
  hours_run       numeric,
  litres_per_hour numeric,
  cost_per_hour   numeric,
  rate_per_litre  numeric,
  -- shared
  total_cost      numeric,
  remarks         text,
  entered_by      text,
  -- maintenance columns (null for fuel rows)
  engine_oil      numeric,
  oil_filter      numeric,
  fuel_filter     numeric,
  air_filter      numeric,
  radiator_service    numeric,
  periodic_maintenance numeric,
  other_mechanical_work numeric,
  others          numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    fl.id           AS event_id,
    'fuel'::text    AS event_type,
    fl.refuel_date  AS event_date,
    fl.qty_litres,
    fl.hours_run,
    fl.litres_per_hour,
    fl.cost_per_hour,
    fl.rate_per_litre,
    fl.total_cost,
    fl.remarks,
    fl.entered_by,
    NULL::numeric AS engine_oil,
    NULL::numeric AS oil_filter,
    NULL::numeric AS fuel_filter,
    NULL::numeric AS air_filter,
    NULL::numeric AS radiator_service,
    NULL::numeric AS periodic_maintenance,
    NULL::numeric AS other_mechanical_work,
    NULL::numeric AS others
  FROM generator_fuel_log fl
  WHERE fl.generator_id = p_generator_id
    AND fl.is_deleted = false
    AND (p_date_from IS NULL OR fl.refuel_date >= p_date_from)
    AND (p_date_to   IS NULL OR fl.refuel_date <= p_date_to)

  UNION ALL

  SELECT
    ml.id                AS event_id,
    'maintenance'::text  AS event_type,
    ml.maintenance_date  AS event_date,
    NULL::numeric AS qty_litres,
    NULL::numeric AS hours_run,
    NULL::numeric AS litres_per_hour,
    NULL::numeric AS cost_per_hour,
    NULL::numeric AS rate_per_litre,
    ml.total_cost,
    ml.remarks,
    ml.entered_by,
    ml.engine_oil,
    ml.oil_filter,
    ml.fuel_filter,
    ml.air_filter,
    ml.radiator_service,
    ml.periodic_maintenance,
    ml.other_mechanical_work,
    ml.others
  FROM generator_maintenance_log ml
  WHERE ml.generator_id = p_generator_id
    AND ml.is_deleted = false
    AND (p_date_from IS NULL OR ml.maintenance_date >= p_date_from)
    AND (p_date_to   IS NULL OR ml.maintenance_date <= p_date_to)

  ORDER BY event_date DESC, event_type;
$$;

REVOKE ALL ON FUNCTION public.get_generator_history(uuid, date, date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_generator_history(uuid, date, date) TO authenticated;
