-- ============================================================
-- 154: Fix EOBI payment calendar (proper CROSS JOIN for all 8
--      entity×type combos) + expose updated_at in registrations
--
-- Apply in Supabase SQL Editor — do NOT auto-run.
-- ============================================================

-- 1) Update get_admin_registrations to return eobi_updated_at
--    and ss_updated_at so the UI can show "Last Updated".
CREATE OR REPLACE FUNCTION get_admin_registrations()
RETURNS TABLE (
  location_id      uuid,
  name             text,
  entity           text,
  location_type    text,
  eobi_status      text,
  eobi_notes       text,
  eobi_updated_at  timestamptz,
  ss_status        text,
  ss_notes         text,
  ss_updated_at    timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    l.id,
    l.name,
    l.entity,
    l.location_type,
    MAX(CASE WHEN r.registration_type = 'EOBI'            THEN r.status     END),
    MAX(CASE WHEN r.registration_type = 'EOBI'            THEN r.notes      END),
    MAX(CASE WHEN r.registration_type = 'EOBI'            THEN r.updated_at END),
    MAX(CASE WHEN r.registration_type = 'Social Security' THEN r.status     END),
    MAX(CASE WHEN r.registration_type = 'Social Security' THEN r.notes      END),
    MAX(CASE WHEN r.registration_type = 'Social Security' THEN r.updated_at END)
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


-- 2) Fix get_eobi_payment_calendar.
--
--    BUG in old version:
--      SELECT unnest(ARRAY['IFPL','Baranh','HD','UTPL']),
--             unnest(ARRAY['EOBI','Social Security'])
--    In PostgreSQL, parallel unnest() in SELECT zips the arrays —
--    it produces 4 pairs (IFPL/EOBI, Baranh/SS, HD/EOBI, UTPL/SS),
--    NOT all 8 combinations.  That's why only some entities appeared.
--
--    FIX: use a proper CROSS JOIN to generate all 4×2 = 8 combos.
CREATE OR REPLACE FUNCTION get_eobi_payment_calendar(p_year int)
RETURNS TABLE (entity text, payment_type text, months jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH months_series AS (
    SELECT generate_series(1, 12) AS mo
  ),
  combos AS (
    SELECT e.entity, pt.payment_type
    FROM   unnest(ARRAY['IFPL','Baranh','HD','UTPL'])      AS e(entity)
    CROSS JOIN unnest(ARRAY['EOBI','Social Security'])     AS pt(payment_type)
  ),
  payments AS (
    SELECT
      entity,
      payment_type,
      EXTRACT(MONTH FROM month)::int AS mo,
      amount_pkr,
      date_paid,
      challan_number,
      is_late
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
        WHEN p_year > EXTRACT(YEAR FROM CURRENT_DATE)::int
          THEN 'future'
        WHEN p_year = EXTRACT(YEAR FROM CURRENT_DATE)::int
             AND ms.mo > EXTRACT(MONTH FROM CURRENT_DATE)::int
             AND p.date_paid IS NULL
          THEN 'future'
        WHEN p.date_paid IS NULL
          THEN 'missing'
        WHEN p.is_late = true
          THEN 'late'
        ELSE 'on_time'
      END AS status_code
    FROM   combos           c
    CROSS  JOIN months_series ms
    LEFT   JOIN payments    p ON p.entity       = c.entity
                             AND p.payment_type  = c.payment_type
                             AND p.mo            = ms.mo
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
  FROM  pivoted
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
