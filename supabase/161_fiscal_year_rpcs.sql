-- ============================================================
-- 161: Switch all Operations RPCs to fiscal year (July – June)
--
-- Previously every RPC filtered by EXTRACT(YEAR FROM date) = p_year,
-- which is a calendar year (Jan–Dec). Unze Group's fiscal year runs
-- July to June, so p_year now means the JULY start year:
--
--   p_year = 2025  →  1 Jul 2025 – 30 Jun 2026  (FY 2025-26)
--   p_year = 2026  →  1 Jul 2026 – 30 Jun 2027  (FY 2026-27)
--
-- RPCs affected:
--   1. get_fuel_summary
--   2. get_solar_summary
--   3. get_utility_summary
--   4. get_vehicle_detail
--   5. pnl_ytd_summary  (used Jan 1 as year-start — now uses Jul 1)
--
-- The returned 'month' column remains a calendar month integer (1–12).
-- The UI is responsible for displaying months in fiscal order (Jul first).
--
-- Apply in Supabase SQL Editor — do NOT auto-run.
-- ============================================================


-- ── 1. Fuel summary ───────────────────────────────────────────────────

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
  WITH fy AS (
    -- FY window: 1 Jul p_year → 30 Jun (p_year+1)
    SELECT
      make_date(p_year,     7, 1) AS fy_start,
      make_date(p_year + 1, 7, 1) AS fy_end        -- exclusive upper bound
  ),
  months AS (
    -- All 12 calendar months that fall inside the fiscal year:
    -- 7,8,9,10,11,12  (July–Dec of p_year)
    -- 1,2,3,4,5,6     (Jan–Jun of p_year+1)
    SELECT mo FROM unnest(ARRAY[7,8,9,10,11,12,1,2,3,4,5,6]) AS t(mo)
  ),
  agg AS (
    SELECT
      EXTRACT(MONTH FROM f.date)::int          AS mo,
      f.vehicle_id,
      COUNT(*)                                 AS fills,
      ROUND(SUM(f.quantity_litres), 2)         AS total_litres,
      ROUND(SUM(f.amount_pkr), 2)              AS total_amount,
      ROUND(AVG(f.km_per_litre), 2)            AS avg_km_per_l
    FROM admin_fuel_log f, fy
    WHERE f.date >= fy.fy_start
      AND f.date <  fy.fy_end
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
    a.avg_km_per_l                -- NULL when no data (show "—" not "0 km/L")
  FROM admin_vehicles v
  CROSS JOIN months m
  LEFT JOIN agg a ON a.vehicle_id = v.id AND a.mo = m.mo
  WHERE v.is_active = true
  ORDER BY
    -- Fiscal order: Jul(7)…Dec(12) first, then Jan(1)…Jun(6)
    CASE WHEN m.mo >= 7 THEN m.mo - 7 ELSE m.mo + 5 END,
    v.name;
$$;


-- ── 2. Solar summary ──────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_solar_summary(int);

CREATE OR REPLACE FUNCTION get_solar_summary(p_year int)
RETURNS TABLE (
  branch_id    uuid,
  branch_name  text,
  system_kw    numeric,
  months       jsonb
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
  monthly AS (
    SELECT
      r.branch_id,
      EXTRACT(MONTH FROM r.date)::int AS mo,
      SUM(r.units_produced_kwh)       AS total_kwh,
      COUNT(*)                        AS days_entered
    FROM admin_solar_readings r, fy
    WHERE r.date >= fy.fy_start
      AND r.date <  fy.fy_end
    GROUP BY r.branch_id, EXTRACT(MONTH FROM r.date)::int
  )
  SELECT
    b.id,
    b.name,
    b.system_kw,
    jsonb_agg(
      jsonb_build_object(
        'month',        m.mo,
        'total_kwh',    m.total_kwh,
        'days_entered', m.days_entered
      )
      -- Fiscal order: Jul first
      ORDER BY CASE WHEN m.mo >= 7 THEN m.mo - 7 ELSE m.mo + 5 END
    ) FILTER (WHERE m.mo IS NOT NULL) AS months
  FROM admin_solar_branches b
  LEFT JOIN monthly m ON m.branch_id = b.id
  WHERE b.is_active = true
  GROUP BY b.id, b.name, b.system_kw
  ORDER BY b.name;
$$;


-- ── 3. Utility summary ────────────────────────────────────────────────

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
  WITH fy AS (
    SELECT
      make_date(p_year,     7, 1) AS fy_start,
      make_date(p_year + 1, 7, 1) AS fy_end
  ),
  monthly AS (
    SELECT
      u.location_id,
      EXTRACT(MONTH FROM u.reading_date)::int  AS mo,
      ROUND(SUM(u.bill_amount_pkr), 0)         AS total_bill,
      COUNT(DISTINCT u.meter_label)            AS meters_read
    FROM admin_utility_readings u, fy
    WHERE u.reading_date >= fy.fy_start
      AND u.reading_date <  fy.fy_end
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
      )
      ORDER BY CASE WHEN m.mo >= 7 THEN m.mo - 7 ELSE m.mo + 5 END
    ) FILTER (WHERE m.mo IS NOT NULL) AS months
  FROM admin_locations l
  LEFT JOIN monthly m ON m.location_id = l.id
  WHERE l.is_active = true
  GROUP BY l.id, l.name, l.entity
  ORDER BY l.entity, l.name;
$$;


-- ── 4. Vehicle detail ─────────────────────────────────────────────────

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


-- ── 5. P&L YTD summary ───────────────────────────────────────────────
-- Previously used date_trunc('year', p_month) which gave 1 Jan.
-- Now uses fiscal year start (1 Jul) so YTD is correct Jul–Jun.

CREATE OR REPLACE FUNCTION pnl_ytd_summary(p_company_id uuid, p_month date)
RETURNS TABLE (
  ytd_sales numeric, ytd_sales_last_year numeric,
  ytd_profit numeric, ytd_profit_last_year numeric
)
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
AS $$
  WITH bounds AS (
    SELECT
      -- Fiscal year starts 1 Jul: if month >= 7, start is this year; else last year
      CASE
        WHEN EXTRACT(MONTH FROM p_month) >= 7
          THEN make_date(EXTRACT(YEAR FROM p_month)::int, 7, 1)
        ELSE
          make_date(EXTRACT(YEAR FROM p_month)::int - 1, 7, 1)
      END AS fy_start
  )
  SELECT
    (SELECT sum(amount) FROM pnl_line_items, bounds
       WHERE company_id = p_company_id AND plant = 'Total' AND line = 'Gross Sale'
         AND month BETWEEN bounds.fy_start AND p_month),
    (SELECT sum(amount) FROM pnl_line_items, bounds
       WHERE company_id = p_company_id AND plant = 'Total' AND line = 'Gross Sale'
         AND month BETWEEN bounds.fy_start - interval '1 year' AND p_month - interval '1 year'),
    (SELECT sum(amount) FROM pnl_line_items, bounds
       WHERE company_id = p_company_id AND plant = 'Total' AND line = 'GP'
         AND month BETWEEN bounds.fy_start AND p_month),
    (SELECT sum(amount) FROM pnl_line_items, bounds
       WHERE company_id = p_company_id AND plant = 'Total' AND line = 'GP'
         AND month BETWEEN bounds.fy_start - interval '1 year' AND p_month - interval '1 year');
$$;
