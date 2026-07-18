-- ============================================================
-- 160: Vehicle detail RPC — per-vehicle analysis panel
--
-- Returns all fuel fills + maintenance records for a vehicle
-- in a given year, as a single JSON object.
-- Used by the vehicle detail side panel in Admin > Operations.
--
-- Apply in Supabase SQL Editor — do NOT auto-run.
-- ============================================================

CREATE OR REPLACE FUNCTION get_vehicle_detail(p_vehicle_id uuid, p_year int)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'fuel', (
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'date',               to_char(f.date, 'YYYY-MM-DD'),
            'price_per_litre',    f.price_per_litre,
            'quantity_litres',    f.quantity_litres,
            'amount_pkr',         f.amount_pkr,
            'previous_odometer',  f.previous_odometer,
            'current_odometer',   f.current_odometer,
            'km_per_litre',       f.km_per_litre,
            'mileage_km',         f.mileage_km
          ) ORDER BY f.date
        ),
        '[]'::json
      )
      FROM admin_fuel_log f
      WHERE f.vehicle_id = p_vehicle_id
        AND EXTRACT(YEAR FROM f.date) = p_year
    ),
    'maintenance', (
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'date',         to_char(m.date, 'YYYY-MM-DD'),
            'work_type',    m.work_type,
            'description',  m.description,
            'odometer_km',  m.odometer_km,
            'cost_pkr',     m.cost_pkr,
            'workshop',     m.workshop
          ) ORDER BY m.date
        ),
        '[]'::json
      )
      FROM admin_vehicle_maintenance m
      WHERE m.vehicle_id = p_vehicle_id
        AND EXTRACT(YEAR FROM m.date) = p_year
    )
  )
$$;
