-- 162_fuel_edit.sql
-- ── Fuel entry amendment support ──────────────────────────────────────────────
-- 1. Update get_vehicle_detail RPC to expose id, notes, entered_by on each
--    fuel entry so the UI can drive the PATCH/DELETE API routes.
-- 2. Add UPDATE + DELETE RLS policies on admin_fuel_log (the API uses the
--    service client which bypasses RLS, but policies keep the table consistent
--    if direct DB access is ever used).
--
-- Apply manually in Supabase SQL Editor.

-- ── 1. RPC: add id, notes, entered_by to fuel json ────────────────────────────
DROP FUNCTION IF EXISTS get_vehicle_detail(uuid, int);

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
            'id',                 f.id,
            'date',               to_char(f.date, 'YYYY-MM-DD'),
            'price_per_litre',    f.price_per_litre,
            'quantity_litres',    f.quantity_litres,
            'amount_pkr',         f.amount_pkr,
            'previous_odometer',  f.previous_odometer,
            'current_odometer',   f.current_odometer,
            'km_per_litre',       f.km_per_litre,
            'mileage_km',         f.mileage_km,
            'notes',              f.notes,
            'entered_by',         f.entered_by
          ) ORDER BY f.date
        ),
        '[]'::json
      )
      FROM admin_fuel_log f
      WHERE f.vehicle_id = p_vehicle_id
        AND f.date >= make_date(p_year,     7, 1)
        AND f.date <  make_date(p_year + 1, 7, 1)
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
        AND m.date >= make_date(p_year,     7, 1)
        AND m.date <  make_date(p_year + 1, 7, 1)
    )
  )
$$;

-- ── 2. RLS: UPDATE and DELETE policies on admin_fuel_log ─────────────────────
-- The API uses createServiceClient() (service role) which bypasses RLS,
-- so these are for completeness / direct DB access hygiene.
CREATE POLICY "auth_update" ON admin_fuel_log
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_delete" ON admin_fuel_log
  FOR DELETE TO authenticated USING (true);
