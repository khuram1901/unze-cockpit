-- Migration 280: Fix get_generator_summary() column names to match frontend GenSummaryRow type
-- Problem: RPC returned fuel_litres_month/fuel_cost_month/last_maintenance_date/hours_since_maint
--          but frontend reads total_litres/total_fuel_cost/last_service_date/hours_since_last_service
--          Also missing: generator_label, is_active, total_refuels, days_since_service
-- Fix: Drop and recreate with correct column names

-- ── ROLLBACK (run first if needed) ───────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.get_generator_summary();
-- (restore the previous version from migration 277)

-- ── MIGRATION ─────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_generator_summary();

CREATE FUNCTION public.get_generator_summary()
RETURNS TABLE(
  generator_id             uuid,
  generator_label          text,
  location_name            text,
  kva                      integer,
  model                    text,
  is_active                boolean,
  total_refuels            bigint,
  total_litres             numeric,
  total_fuel_cost          numeric,
  avg_litres_per_hour      numeric,
  avg_cost_per_hour        numeric,
  last_refuel_date         date,
  last_service_date        date,
  days_since_refuel        integer,
  days_since_service       integer,
  hours_since_last_service numeric,
  refuel_rag               text,
  service_overdue          boolean,
  unusual_flag             boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
WITH thresh AS (
  SELECT unusual_consumption_pct, service_overdue_hours, refuel_amber_days, refuel_red_days
  FROM generator_thresholds LIMIT 1
),
month_fuel AS (
  SELECT fl.generator_id,
    COUNT(*)::bigint   AS total_refuels,
    SUM(fl.qty_litres) AS litres,
    SUM(fl.total_cost) AS cost
  FROM generator_fuel_log fl
  WHERE fl.is_deleted = false
    AND fl.refuel_date >= date_trunc('month', CURRENT_DATE)
  GROUP BY fl.generator_id
),
overall_avg AS (
  SELECT fl.generator_id,
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
  SELECT DISTINCT ON (fl.generator_id)
    fl.generator_id,
    fl.present_hours
  FROM generator_fuel_log fl
  WHERE fl.is_deleted = false AND fl.present_hours IS NOT NULL
  ORDER BY fl.generator_id, fl.refuel_date DESC
),
maint_hours AS (
  SELECT DISTINCT ON (fl.generator_id)
    fl.generator_id,
    fl.present_hours AS maint_hours
  FROM generator_fuel_log fl
  JOIN last_maint lm ON lm.generator_id = fl.generator_id
  WHERE fl.is_deleted = false
    AND fl.present_hours IS NOT NULL
    AND fl.refuel_date <= lm.maintenance_date
  ORDER BY fl.generator_id, fl.refuel_date DESC
)
SELECT
  g.id                                                 AS generator_id,
  COALESCE(g.label, g.model || ' ' || g.kva || 'KVA') AS generator_label,
  al.name                                              AS location_name,
  g.kva,
  g.model,
  g.is_active,
  COALESCE(mf.total_refuels, 0)                        AS total_refuels,
  COALESCE(mf.litres, 0)                               AS total_litres,
  COALESCE(mf.cost, 0)                                 AS total_fuel_cost,
  oa.avg_lph                                           AS avg_litres_per_hour,
  oa.avg_cph                                           AS avg_cost_per_hour,
  lr.refuel_date                                       AS last_refuel_date,
  lm.maintenance_date                                  AS last_service_date,
  (CURRENT_DATE - lr.refuel_date)::integer             AS days_since_refuel,
  (CURRENT_DATE - lm.maintenance_date)::integer        AS days_since_service,
  CASE
    WHEN lh.present_hours IS NOT NULL AND mh.maint_hours IS NOT NULL
    THEN lh.present_hours - mh.maint_hours
  END                                                  AS hours_since_last_service,
  CASE
    WHEN lr.refuel_date IS NULL                                         THEN 'red'
    WHEN (CURRENT_DATE - lr.refuel_date) >= th.refuel_red_days         THEN 'red'
    WHEN (CURRENT_DATE - lr.refuel_date) >= th.refuel_amber_days       THEN 'amber'
    ELSE 'green'
  END                                                  AS refuel_rag,
  CASE
    WHEN lh.present_hours IS NOT NULL AND mh.maint_hours IS NOT NULL
    THEN (lh.present_hours - mh.maint_hours) >= th.service_overdue_hours
    ELSE false
  END                                                  AS service_overdue,
  CASE
    WHEN oa.avg_lph IS NOT NULL AND lr.last_lph IS NOT NULL
    THEN lr.last_lph > oa.avg_lph * (1 + (th.unusual_consumption_pct::numeric / 100))
    ELSE false
  END                                                  AS unusual_flag
FROM generators g
JOIN admin_locations al ON al.id = g.location_id
CROSS JOIN thresh th
LEFT JOIN month_fuel   mf ON mf.generator_id = g.id
LEFT JOIN overall_avg  oa ON oa.generator_id = g.id
LEFT JOIN last_refuel  lr ON lr.generator_id = g.id
LEFT JOIN last_maint   lm ON lm.generator_id = g.id
LEFT JOIN last_hours   lh ON lh.generator_id = g.id
LEFT JOIN maint_hours  mh ON mh.generator_id = g.id
WHERE g.is_active = true
ORDER BY al.name, g.kva DESC;
$$;

-- Verify
SELECT 'get_generator_summary column names fixed' AS status;
