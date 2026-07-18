-- ============================================================
-- 158: Operations tab RPC fixes
--
-- 1) Fix get_fuel_summary — CROSS JOIN vehicles × months so
--    every active vehicle always appears, even with no fuel entries
--
-- 2) Add get_utility_summary — all active locations with their
--    monthly bill totals, so the Sites section always shows
--
-- Apply in Supabase SQL Editor — do NOT auto-run.
-- ============================================================

-- ── 1) Fix fuel summary ────────────────────────────────────────────────
-- Must DROP first because return type is unchanged but we're changing the
-- function body significantly (avoids "cannot replace" errors on some PG versions)

DROP FUNCTION IF EXISTS get_fuel_summary(int);

CREATE OR REPLACE FUNCTION get_fuel_summary(p_year int)
RETURNS TABLE (
  month         int,
  vehicle_id    uuid,
  vehicle_name  text,
  plate_number  text,
  fills         bigint,
  total_litres  numeric,
  total_amount  numeric,
  avg_km_per_l  numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH months AS (
    SELECT generate_series(1, 12) AS mo
  ),
  agg AS (
    SELECT
      EXTRACT(MONTH FROM f.date)::int          AS mo,
      f.vehicle_id,
      COUNT(*)                                 AS fills,
      ROUND(SUM(f.quantity_litres), 2)         AS total_litres,
      ROUND(SUM(f.amount_pkr), 2)              AS total_amount,
      ROUND(AVG(f.km_per_litre), 2)            AS avg_km_per_l
    FROM admin_fuel_log f
    WHERE EXTRACT(YEAR FROM f.date) = p_year
    GROUP BY EXTRACT(MONTH FROM f.date)::int, f.vehicle_id
  )
  SELECT
    m.mo                          AS month,
    v.id                          AS vehicle_id,
    v.name                        AS vehicle_name,
    v.plate_number,
    COALESCE(a.fills, 0)          AS fills,
    COALESCE(a.total_litres, 0)   AS total_litres,
    COALESCE(a.total_amount, 0)   AS total_amount,
    a.avg_km_per_l                -- NULL when no entries (not 0 — we want to show "—" not "0 km/L")
  FROM admin_vehicles v
  CROSS JOIN months m
  LEFT JOIN agg a ON a.vehicle_id = v.id AND a.mo = m.mo
  WHERE v.is_active = true
  ORDER BY m.mo, v.name;
$$;


-- ── 2) Utility summary ──────────────────────────────────────────────────
-- Returns all active locations with their monthly utility bill totals.
-- Mirrors the shape of get_solar_summary (jsonb months array).

CREATE OR REPLACE FUNCTION get_utility_summary(p_year int)
RETURNS TABLE (
  location_id   uuid,
  location_name text,
  entity        text,
  months        jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH monthly AS (
    SELECT
      u.location_id,
      EXTRACT(MONTH FROM u.reading_date)::int  AS mo,
      ROUND(SUM(u.bill_amount_pkr), 0)         AS total_bill,
      COUNT(DISTINCT u.meter_label)            AS meters_read
    FROM admin_utility_readings u
    WHERE EXTRACT(YEAR FROM u.reading_date) = p_year
    GROUP BY u.location_id, EXTRACT(MONTH FROM u.reading_date)::int
  )
  SELECT
    l.id,
    l.name,
    l.entity,
    jsonb_agg(
      jsonb_build_object(
        'month',       m.mo,
        'total_bill',  m.total_bill,
        'meters_read', m.meters_read
      ) ORDER BY m.mo
    ) FILTER (WHERE m.mo IS NOT NULL)   AS months
  FROM admin_locations l
  LEFT JOIN monthly m ON m.location_id = l.id
  WHERE l.is_active = true
  GROUP BY l.id, l.name, l.entity
  ORDER BY l.entity, l.name;
$$;
