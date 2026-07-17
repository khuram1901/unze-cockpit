-- ─────────────────────────────────────────────────────────────────────
-- Migration 152 — Admin Operations RPCs
-- All aggregation in DB; API routes are thin wrappers.
-- ─────────────────────────────────────────────────────────────────────

-- ── RPC 1: Registrations grid ────────────────────────────────────────
-- Returns every location with its EOBI and Social Security status
-- in a single row (pivot). Ordered by entity then name.
CREATE OR REPLACE FUNCTION get_admin_registrations()
RETURNS TABLE (
  location_id        uuid,
  name               text,
  entity             text,
  location_type      text,
  eobi_status        text,
  eobi_notes         text,
  ss_status          text,
  ss_notes           text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.name,
    l.entity,
    l.location_type,
    MAX(CASE WHEN r.registration_type = 'EOBI'             THEN r.status END) AS eobi_status,
    MAX(CASE WHEN r.registration_type = 'EOBI'             THEN r.notes  END) AS eobi_notes,
    MAX(CASE WHEN r.registration_type = 'Social Security'  THEN r.status END) AS ss_status,
    MAX(CASE WHEN r.registration_type = 'Social Security'  THEN r.notes  END) AS ss_notes
  FROM admin_locations l
  LEFT JOIN admin_registrations r ON r.location_id = l.id
  WHERE l.is_active = true
  GROUP BY l.id, l.name, l.entity, l.location_type
  ORDER BY
    CASE l.entity
      WHEN 'IFPL'   THEN 1
      WHEN 'Baranh' THEN 2
      WHEN 'HD'     THEN 3
      WHEN 'UTPL'   THEN 4
      ELSE 5
    END,
    l.name;
$$;

-- ── RPC 2: EOBI / Social Security payment calendar ───────────────────
-- Returns one row per entity+type with a JSON array of 12 months.
-- p_year: the calendar year (e.g. 2026)
CREATE OR REPLACE FUNCTION get_eobi_payment_calendar(p_year int)
RETURNS TABLE (
  entity        text,
  payment_type  text,
  months        jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH months_series AS (
    SELECT generate_series(1, 12) AS mo
  ),
  combos AS (
    SELECT DISTINCT entity, payment_type FROM admin_eobi_payments
    UNION
    SELECT unnest(ARRAY['IFPL','Baranh','HD','UTPL']), unnest(ARRAY['EOBI','Social Security'])
  ),
  payments AS (
    SELECT entity, payment_type, EXTRACT(MONTH FROM month)::int AS mo,
           amount_pkr, date_paid, challan_number, is_late
    FROM admin_eobi_payments
    WHERE EXTRACT(YEAR FROM month) = p_year
  ),
  pivoted AS (
    SELECT
      c.entity,
      c.payment_type,
      ms.mo,
      p.amount_pkr,
      p.date_paid,
      p.challan_number,
      p.is_late,
      CASE
        WHEN ms.mo > EXTRACT(MONTH FROM CURRENT_DATE) AND p.date_paid IS NULL THEN 'future'
        WHEN p.date_paid IS NULL THEN 'missing'
        WHEN p.is_late = true   THEN 'late'
        ELSE 'on_time'
      END AS status_code
    FROM combos c
    CROSS JOIN months_series ms
    LEFT JOIN payments p ON p.entity = c.entity
                        AND p.payment_type = c.payment_type
                        AND p.mo = ms.mo
  )
  SELECT
    entity,
    payment_type,
    jsonb_agg(
      jsonb_build_object(
        'month',          mo,
        'amount_pkr',     amount_pkr,
        'date_paid',      date_paid,
        'challan_number', challan_number,
        'is_late',        is_late,
        'status',         status_code
      ) ORDER BY mo
    ) AS months
  FROM pivoted
  GROUP BY entity, payment_type
  ORDER BY
    CASE entity
      WHEN 'IFPL'   THEN 1
      WHEN 'Baranh' THEN 2
      WHEN 'HD'     THEN 3
      WHEN 'UTPL'   THEN 4
    END,
    payment_type;
$$;

-- ── RPC 3: Compliance grid ────────────────────────────────────────────
-- Compliance status per location × compliance_type (3 columns)
CREATE OR REPLACE FUNCTION get_admin_compliance()
RETURNS TABLE (
  location_id            uuid,
  name                   text,
  entity                 text,
  civil_defence_status   text,
  civil_defence_due      date,
  labour_reg_status      text,
  labour_reg_due         date,
  labour_insp_status     text,
  labour_insp_due        date
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.name,
    l.entity,
    MAX(CASE WHEN c.compliance_type = 'Civil Defence'        THEN c.status   END),
    MAX(CASE WHEN c.compliance_type = 'Civil Defence'        THEN c.next_due END)::date,
    MAX(CASE WHEN c.compliance_type = 'Labour Registration'  THEN c.status   END),
    MAX(CASE WHEN c.compliance_type = 'Labour Registration'  THEN c.next_due END)::date,
    MAX(CASE WHEN c.compliance_type = 'Labour Inspection'    THEN c.status   END),
    MAX(CASE WHEN c.compliance_type = 'Labour Inspection'    THEN c.next_due END)::date
  FROM admin_locations l
  LEFT JOIN admin_compliance c ON c.location_id = l.id
  WHERE l.is_active = true
    AND l.location_type IN ('retail', 'plant', 'warehouse')
  GROUP BY l.id, l.name, l.entity
  ORDER BY
    CASE l.entity
      WHEN 'IFPL'   THEN 1
      WHEN 'Baranh' THEN 2
      WHEN 'HD'     THEN 3
      WHEN 'UTPL'   THEN 4
      ELSE 5
    END,
    l.name;
$$;

-- ── RPC 4: Documents — NTN on WAPDA ──────────────────────────────────
CREATE OR REPLACE FUNCTION get_admin_ntn_docs()
RETURNS TABLE (
  doc_id        uuid,
  location_id   uuid,
  location_name text,
  entity        text,
  meter_label   text,
  ntn_number    text,
  status        text,
  folderit_link text,
  updated_at    timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id,
    l.id,
    l.name,
    l.entity,
    d.meter_label,
    d.ntn_number,
    d.status,
    d.folderit_link,
    d.updated_at
  FROM admin_ntn_docs d
  JOIN admin_locations l ON l.id = d.location_id
  WHERE l.is_active = true
  ORDER BY l.entity, l.name, d.meter_label;
$$;

-- ── RPC 5: Documents — Restaurant licences ────────────────────────────
CREATE OR REPLACE FUNCTION get_admin_restaurant_licences()
RETURNS TABLE (
  location_id      uuid,
  location_name    text,
  entity           text,
  pfa_status       text,
  pfa_link         text,
  pfa_expiry       date,
  medical_status   text,
  medical_link     text,
  medical_expiry   date,
  training_status  text,
  training_link    text,
  training_expiry  date,
  tourism_status   text,
  tourism_link     text,
  tourism_expiry   date
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.name,
    l.entity,
    MAX(CASE WHEN rl.licence_type = 'PFA Licence'           THEN rl.status      END),
    MAX(CASE WHEN rl.licence_type = 'PFA Licence'           THEN rl.folderit_link END),
    MAX(CASE WHEN rl.licence_type = 'PFA Licence'           THEN rl.expiry_date END)::date,
    MAX(CASE WHEN rl.licence_type = 'Medical Certificate'   THEN rl.status      END),
    MAX(CASE WHEN rl.licence_type = 'Medical Certificate'   THEN rl.folderit_link END),
    MAX(CASE WHEN rl.licence_type = 'Medical Certificate'   THEN rl.expiry_date END)::date,
    MAX(CASE WHEN rl.licence_type = 'Training Certificate'  THEN rl.status      END),
    MAX(CASE WHEN rl.licence_type = 'Training Certificate'  THEN rl.folderit_link END),
    MAX(CASE WHEN rl.licence_type = 'Training Certificate'  THEN rl.expiry_date END)::date,
    MAX(CASE WHEN rl.licence_type = 'Tourism Certificate'   THEN rl.status      END),
    MAX(CASE WHEN rl.licence_type = 'Tourism Certificate'   THEN rl.folderit_link END),
    MAX(CASE WHEN rl.licence_type = 'Tourism Certificate'   THEN rl.expiry_date END)::date
  FROM admin_locations l
  LEFT JOIN admin_restaurant_licences rl ON rl.location_id = l.id
  WHERE l.is_active = true
    AND l.entity IN ('Baranh', 'HD')
    AND l.location_type = 'restaurant'
  GROUP BY l.id, l.name, l.entity
  ORDER BY l.entity, l.name;
$$;

-- ── RPC 6: Operations — Fuel summary by month ─────────────────────────
-- Returns monthly totals + per-vehicle breakdown for a given year
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
  SELECT
    EXTRACT(MONTH FROM f.date)::int AS month,
    v.id,
    v.name,
    v.plate_number,
    COUNT(*),
    ROUND(SUM(f.quantity_litres), 2),
    ROUND(SUM(f.amount_pkr), 2),
    ROUND(AVG(f.km_per_litre), 2)
  FROM admin_fuel_log f
  JOIN admin_vehicles v ON v.id = f.vehicle_id
  WHERE EXTRACT(YEAR FROM f.date) = p_year
  GROUP BY
    EXTRACT(MONTH FROM f.date)::int,
    v.id, v.name, v.plate_number
  ORDER BY month, v.name;
$$;

-- ── RPC 7: Operations — Solar summary grid ────────────────────────────
-- Returns monthly total kWh per branch for a given year
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
  WITH monthly AS (
    SELECT
      r.branch_id,
      EXTRACT(MONTH FROM r.date)::int AS mo,
      SUM(r.production_kwh) AS total_kwh,
      COUNT(*) AS days_entered
    FROM admin_solar_readings r
    WHERE EXTRACT(YEAR FROM r.date) = p_year
    GROUP BY r.branch_id, EXTRACT(MONTH FROM r.date)::int
  )
  SELECT
    b.id,
    b.name,
    b.system_kw,
    jsonb_agg(
      jsonb_build_object(
        'month',       m.mo,
        'total_kwh',   m.total_kwh,
        'days_entered', m.days_entered
      ) ORDER BY m.mo
    ) FILTER (WHERE m.mo IS NOT NULL) AS months
  FROM admin_solar_branches b
  LEFT JOIN monthly m ON m.branch_id = b.id
  WHERE b.is_active = true
  GROUP BY b.id, b.name, b.system_kw
  ORDER BY b.name;
$$;

-- ── RPC 8: Daily entry helpers ────────────────────────────────────────
-- Returns active vehicles for fuel / maintenance entry dropdowns
CREATE OR REPLACE FUNCTION get_active_vehicles()
RETURNS TABLE (id uuid, name text, plate_number text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, plate_number
  FROM admin_vehicles
  WHERE is_active = true
  ORDER BY name;
$$;

-- Returns active solar branches for solar reading entry
CREATE OR REPLACE FUNCTION get_active_solar_branches()
RETURNS TABLE (id uuid, name text, system_kw numeric)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, system_kw
  FROM admin_solar_branches
  WHERE is_active = true
  ORDER BY name;
$$;

-- Returns active locations for utility reading entry
CREATE OR REPLACE FUNCTION get_active_locations()
RETURNS TABLE (id uuid, name text, entity text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, entity
  FROM admin_locations
  WHERE is_active = true
  ORDER BY entity, name;
$$;

-- ── RPC 9: Last odometer for a vehicle ───────────────────────────────
-- Lets the daily entry form pre-fill "previous odometer"
CREATE OR REPLACE FUNCTION get_last_odometer(p_vehicle_id uuid)
RETURNS TABLE (current_odometer int, fill_date date)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_odometer, date
  FROM admin_fuel_log
  WHERE vehicle_id = p_vehicle_id
    AND current_odometer IS NOT NULL
  ORDER BY date DESC, created_at DESC
  LIMIT 1;
$$;

-- ── RPC 10: Last utility reading ──────────────────────────────────────
CREATE OR REPLACE FUNCTION get_last_utility_reading(p_location_id uuid, p_meter_label text)
RETURNS TABLE (current_reading int, reading_date date)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_reading, reading_date
  FROM admin_utility_readings
  WHERE location_id = p_location_id
    AND meter_label = p_meter_label
  ORDER BY reading_date DESC, created_at DESC
  LIMIT 1;
$$;
