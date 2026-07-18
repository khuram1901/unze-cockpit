-- Migration 162 — Add odometer_unit to admin_vehicles + update RPC
-- Apply in Supabase SQL Editor.

-- 1. Add odometer_unit column (default 'km', acceptable values: 'km' | 'miles')
ALTER TABLE admin_vehicles
  ADD COLUMN IF NOT EXISTS odometer_unit text NOT NULL DEFAULT 'km';

-- 2. Update get_active_vehicles() to return the new column
-- Must DROP first because the return type is changing (adding odometer_unit)
DROP FUNCTION IF EXISTS get_active_vehicles();
CREATE OR REPLACE FUNCTION get_active_vehicles()
RETURNS TABLE (id uuid, name text, plate_number text, odometer_unit text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, plate_number, odometer_unit
  FROM admin_vehicles
  WHERE is_active = true
  ORDER BY name;
$$;

-- 3. Update get_vehicle_detail_monthly() to include odometer_unit in result
-- Must DROP first because the return type is changing (adding odometer_unit)
DROP FUNCTION IF EXISTS get_vehicle_detail_monthly(uuid, int);
CREATE OR REPLACE FUNCTION get_vehicle_detail_monthly(
  p_vehicle_id uuid,
  p_year       int     -- FY start year, e.g. 2025 = Jul 2025–Jun 2026
)
RETURNS TABLE (
  vehicle_id    uuid,
  vehicle_name  text,
  plate_number  text,
  odometer_unit text,
  month         int,
  fills         int,
  total_litres  numeric,
  total_amount  numeric,
  last_odometer int,
  km_per_litre  numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH fy AS (
    SELECT
      make_date(p_year,     7, 1) AS fy_start,
      make_date(p_year + 1, 7, 1) AS fy_end
  ),
  months AS (
    SELECT generate_series(7, 18) AS mo_offset
  ),
  v AS (
    SELECT id, name, plate_number, odometer_unit
    FROM admin_vehicles
    WHERE id = p_vehicle_id
  )
  SELECT
    v.id                                          AS vehicle_id,
    v.name                                        AS vehicle_name,
    v.plate_number,
    v.odometer_unit,
    -- Convert month offset back to calendar month
    CASE WHEN (m.mo_offset - 1) % 12 + 1 + 6 > 12
         THEN (m.mo_offset - 1) % 12 + 1 + 6 - 12
         ELSE (m.mo_offset - 1) % 12 + 1 + 6
    END                                           AS month,
    COALESCE(COUNT(f.id), 0)::int                 AS fills,
    COALESCE(SUM(f.quantity_litres), 0)           AS total_litres,
    COALESCE(SUM(
      COALESCE(f.amount_pkr, f.price_per_litre * f.quantity_litres)
    ), 0)                                         AS total_amount,
    MAX(f.current_odometer)                       AS last_odometer,
    CASE
      WHEN SUM(f.quantity_litres) > 0
        THEN ROUND(
          SUM(COALESCE(f.current_odometer, 0) - COALESCE(f.previous_odometer, 0))::numeric
          / SUM(f.quantity_litres), 1
        )
      ELSE NULL
    END                                           AS km_per_litre
  FROM v
  CROSS JOIN months m
  CROSS JOIN fy
  LEFT JOIN admin_fuel_log f
    ON f.vehicle_id = v.id
    AND EXTRACT(MONTH FROM f.date)::int = (
      CASE WHEN (m.mo_offset - 1) % 12 + 1 + 6 > 12
           THEN (m.mo_offset - 1) % 12 + 1 + 6 - 12
           ELSE (m.mo_offset - 1) % 12 + 1 + 6
      END
    )
    AND f.date >= fy.fy_start
    AND f.date <  fy.fy_end
  GROUP BY v.id, v.name, v.plate_number, v.odometer_unit, m.mo_offset
  ORDER BY m.mo_offset;
$$;
