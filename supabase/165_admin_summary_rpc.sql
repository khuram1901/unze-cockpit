-- ============================================================
-- Migration 165 — get_admin_summary()
--
-- Returns a single jsonb blob with all data needed for the
-- Admin department summary dashboard:
--   tasks        → open/overdue/urgent/done + per-person breakdown
--   compliance   → % registered per type (EOBI, SS, Civil, Labour)
--   payments     → current-month status per entity + FY late/missing
--   documents    → NTN cert counts + restaurant licence health
--   fleet        → fills, spend, avg kpl, maintenance (current month)
--   solar        → generation, missing sites, best/lowest (current month)
--   utilities    → bill total, missing readings (current month)
--
-- Apply in Supabase SQL Editor — do NOT auto-run.
-- ============================================================

DROP FUNCTION IF EXISTS get_admin_summary();

CREATE OR REPLACE FUNCTION get_admin_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur_month   int  := EXTRACT(MONTH FROM CURRENT_DATE)::int;
  v_cur_year    int  := EXTRACT(YEAR  FROM CURRENT_DATE)::int;
  v_week_start  date := date_trunc('week', CURRENT_DATE)::date;
  v_fy_start    int;
  v_fy_start_dt date;
  v_fy_end_dt   date;
  v_cur_mo_dt   date := date_trunc('month', CURRENT_DATE)::date;

  v_tasks       jsonb;
  v_compliance  jsonb;
  v_payments    jsonb;
  v_documents   jsonb;
  v_fleet       jsonb;
  v_solar       jsonb;
  v_utilities   jsonb;
BEGIN
  -- Fiscal year window (July-June)
  v_fy_start    := CASE WHEN v_cur_month >= 7 THEN v_cur_year ELSE v_cur_year - 1 END;
  v_fy_start_dt := make_date(v_fy_start,     7, 1);
  v_fy_end_dt   := make_date(v_fy_start + 1, 7, 1);

  -- ── TASKS ────────────────────────────────────────────────────────
  SELECT jsonb_build_object(
    'open',      COUNT(*) FILTER (WHERE status NOT IN ('Completed','Cancelled')),
    'overdue',   COUNT(*) FILTER (WHERE status NOT IN ('Completed','Cancelled') AND due_date < CURRENT_DATE),
    'urgent',    COUNT(*) FILTER (WHERE status NOT IN ('Completed','Cancelled') AND priority IN ('Urgent','High')),
    'done_week', COUNT(*) FILTER (WHERE status = 'Completed' AND updated_at::date >= v_week_start),
    'by_person', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'name',    p.nm,
          'overdue', p.ov,
          'pending', p.pn,
          'done',    p.dn
        ) ORDER BY p.ov DESC, p.pn DESC
      )
      FROM (
        SELECT
          assigned_to AS nm,
          COUNT(*) FILTER (WHERE status NOT IN ('Completed','Cancelled') AND due_date < CURRENT_DATE)                              AS ov,
          COUNT(*) FILTER (WHERE status NOT IN ('Completed','Cancelled') AND (due_date >= CURRENT_DATE OR due_date IS NULL))       AS pn,
          COUNT(*) FILTER (WHERE status = 'Completed' AND updated_at::date >= v_week_start)                                        AS dn
        FROM tasks
        WHERE assigned_to_department = 'Admin'
          AND assigned_to IS NOT NULL
        GROUP BY assigned_to
      ) p
    ), '[]'::jsonb)
  )
  INTO v_tasks
  FROM tasks
  WHERE assigned_to_department = 'Admin';

  -- ── COMPLIANCE ───────────────────────────────────────────────────
  SELECT jsonb_build_object(
    'eobi', jsonb_build_object(
      'registered',
        (SELECT COUNT(*) FROM admin_registrations r JOIN admin_locations l ON l.id = r.location_id AND l.is_active = true WHERE r.registration_type = 'EOBI' AND r.status = 'Registered'),
      'total',
        (SELECT COUNT(*) FROM admin_locations WHERE is_active = true)
    ),
    'ss', jsonb_build_object(
      'registered',
        (SELECT COUNT(*) FROM admin_registrations r JOIN admin_locations l ON l.id = r.location_id AND l.is_active = true WHERE r.registration_type = 'Social Security' AND r.status = 'Registered'),
      'total',
        (SELECT COUNT(*) FROM admin_locations WHERE is_active = true)
    ),
    'civil', jsonb_build_object(
      'registered',
        (SELECT COUNT(*) FROM admin_compliance c JOIN admin_locations l ON l.id = c.location_id AND l.is_active = true WHERE c.compliance_type = 'Civil Defence' AND c.status IN ('Registered','Done')),
      'total',
        (SELECT COUNT(*) FROM admin_compliance c JOIN admin_locations l ON l.id = c.location_id AND l.is_active = true WHERE c.compliance_type = 'Civil Defence')
    ),
    'labour_reg', jsonb_build_object(
      'registered',
        (SELECT COUNT(*) FROM admin_compliance c JOIN admin_locations l ON l.id = c.location_id AND l.is_active = true WHERE c.compliance_type = 'Labour Registration' AND c.status IN ('Registered','Done')),
      'total',
        (SELECT COUNT(*) FROM admin_compliance c JOIN admin_locations l ON l.id = c.location_id AND l.is_active = true WHERE c.compliance_type = 'Labour Registration')
    ),
    'labour_insp', jsonb_build_object(
      'registered',
        (SELECT COUNT(*) FROM admin_compliance c JOIN admin_locations l ON l.id = c.location_id AND l.is_active = true WHERE c.compliance_type = 'Labour Inspection' AND c.status IN ('Registered','Done')),
      'total',
        (SELECT COUNT(*) FROM admin_compliance c JOIN admin_locations l ON l.id = c.location_id AND l.is_active = true WHERE c.compliance_type = 'Labour Inspection')
    )
  )
  INTO v_compliance;

  -- ── PAYMENTS ─────────────────────────────────────────────────────
  SELECT jsonb_build_object(
    'current_month', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'entity',  combo.entity,
          'type',    combo.ptype,
          'status',  CASE WHEN p.date_paid IS NOT NULL THEN 'paid' ELSE 'due' END
        ) ORDER BY combo.entity, combo.ptype
      )
      FROM (
        SELECT e.entity, pt.ptype
        FROM unnest(ARRAY['IFPL','Baranh','HD','UTPL'])          e(entity)
        CROSS JOIN unnest(ARRAY['EOBI','Social Security'])       pt(ptype)
      ) combo
      LEFT JOIN admin_eobi_payments p
             ON p.entity = combo.entity
            AND p.payment_type = combo.ptype
            AND p.month = v_cur_mo_dt
    ),
    'late_fy', (
      SELECT COUNT(*) FROM admin_eobi_payments
      WHERE month >= v_fy_start_dt AND month < v_fy_end_dt AND is_late = true
    ),
    'missing_fy', (
      -- count entity×type×past-month combos with no payment row
      SELECT COUNT(*)
      FROM (
        SELECT e.entity, pt.ptype, gs.mo
        FROM unnest(ARRAY['IFPL','Baranh','HD','UTPL'])          e(entity)
        CROSS JOIN unnest(ARRAY['EOBI','Social Security'])       pt(ptype)
        CROSS JOIN (
          SELECT generate_series(v_fy_start_dt, v_cur_mo_dt - interval '1 month', interval '1 month')::date AS mo
        ) gs
      ) past
      WHERE NOT EXISTS (
        SELECT 1 FROM admin_eobi_payments p
        WHERE p.entity = past.entity
          AND p.payment_type = past.ptype
          AND p.month = past.mo
      )
    )
  )
  INTO v_payments;

  -- ── DOCUMENTS ────────────────────────────────────────────────────
  SELECT jsonb_build_object(
    'ntn_registered', (
      SELECT COUNT(*) FROM admin_ntn_docs d
      JOIN admin_locations l ON l.id = d.location_id AND l.is_active = true
      WHERE d.status = 'Registered'
    ),
    'ntn_pending', (
      SELECT COUNT(*) FROM admin_ntn_docs d
      JOIN admin_locations l ON l.id = d.location_id AND l.is_active = true
      WHERE d.status != 'Registered'
    ),
    'ntn_no_link', (
      SELECT COUNT(*) FROM admin_ntn_docs d
      JOIN admin_locations l ON l.id = d.location_id AND l.is_active = true
      WHERE d.folderit_link IS NULL OR d.folderit_link = ''
    ),
    'pfa_valid', (
      SELECT COUNT(*) FROM admin_restaurant_licences rl
      JOIN admin_locations l ON l.id = rl.location_id AND l.is_active = true
      WHERE rl.licence_type = 'PFA Licence' AND rl.status = 'Done'
    ),
    'pfa_total', (
      SELECT COUNT(*) FROM admin_restaurant_licences rl
      JOIN admin_locations l ON l.id = rl.location_id AND l.is_active = true
      WHERE rl.licence_type = 'PFA Licence'
    ),
    'medical_valid', (
      SELECT COUNT(*) FROM admin_restaurant_licences rl
      JOIN admin_locations l ON l.id = rl.location_id AND l.is_active = true
      WHERE rl.licence_type = 'Medical Certificate' AND rl.status = 'Done'
    ),
    'training_valid', (
      SELECT COUNT(*) FROM admin_restaurant_licences rl
      JOIN admin_locations l ON l.id = rl.location_id AND l.is_active = true
      WHERE rl.licence_type = 'Training Certificate' AND rl.status = 'Done'
    ),
    'tourism_valid', (
      SELECT COUNT(*) FROM admin_restaurant_licences rl
      JOIN admin_locations l ON l.id = rl.location_id AND l.is_active = true
      WHERE rl.licence_type = 'Tourism Certificate' AND rl.status = 'Done'
    ),
    'expiring_30d', (
      SELECT COUNT(*) FROM admin_restaurant_licences rl
      JOIN admin_locations l ON l.id = rl.location_id AND l.is_active = true
      WHERE rl.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
    )
  )
  INTO v_documents;

  -- ── FLEET ────────────────────────────────────────────────────────
  SELECT jsonb_build_object(
    'active_vehicles', (SELECT COUNT(*) FROM admin_vehicles WHERE is_active = true),
    'fills', (
      SELECT COUNT(*) FROM admin_fuel_log
      WHERE EXTRACT(MONTH FROM date) = v_cur_month
        AND EXTRACT(YEAR  FROM date) = v_cur_year
    ),
    'fuel_spend', (
      SELECT COALESCE(ROUND(SUM(amount_pkr), 0), 0) FROM admin_fuel_log
      WHERE EXTRACT(MONTH FROM date) = v_cur_month
        AND EXTRACT(YEAR  FROM date) = v_cur_year
    ),
    'avg_kpl', (
      SELECT COALESCE(ROUND(AVG(km_per_litre), 1), 0) FROM admin_fuel_log
      WHERE EXTRACT(MONTH FROM date) = v_cur_month
        AND EXTRACT(YEAR  FROM date) = v_cur_year
        AND km_per_litre IS NOT NULL
    ),
    'maint_jobs', (
      SELECT COUNT(*) FROM admin_vehicle_maintenance
      WHERE EXTRACT(MONTH FROM date) = v_cur_month
        AND EXTRACT(YEAR  FROM date) = v_cur_year
    ),
    'maint_spend', (
      SELECT COALESCE(ROUND(SUM(cost_pkr), 0), 0) FROM admin_vehicle_maintenance
      WHERE EXTRACT(MONTH FROM date) = v_cur_month
        AND EXTRACT(YEAR  FROM date) = v_cur_year
    ),
    'no_entry', (
      SELECT COUNT(*) FROM admin_vehicles v
      WHERE v.is_active = true
        AND NOT EXISTS (
          SELECT 1 FROM admin_fuel_log f
          WHERE f.vehicle_id = v.id
            AND EXTRACT(MONTH FROM f.date) = v_cur_month
            AND EXTRACT(YEAR  FROM f.date) = v_cur_year
        )
    )
  )
  INTO v_fleet;

  -- ── SOLAR ────────────────────────────────────────────────────────
  SELECT jsonb_build_object(
    'active_sites', (SELECT COUNT(*) FROM admin_solar_branches WHERE is_active = true),
    'total_kwh', (
      SELECT COALESCE(ROUND(SUM(production_kwh), 0), 0) FROM admin_solar_readings
      WHERE EXTRACT(MONTH FROM date) = v_cur_month
        AND EXTRACT(YEAR  FROM date) = v_cur_year
    ),
    'missing_data', (
      SELECT COUNT(*) FROM admin_solar_branches b
      WHERE b.is_active = true
        AND NOT EXISTS (
          SELECT 1 FROM admin_solar_readings r
          WHERE r.branch_id = b.id
            AND EXTRACT(MONTH FROM r.date) = v_cur_month
            AND EXTRACT(YEAR  FROM r.date) = v_cur_year
        )
    ),
    'best_site', (
      SELECT b.name FROM admin_solar_readings r
      JOIN admin_solar_branches b ON b.id = r.branch_id AND b.is_active = true
      WHERE EXTRACT(MONTH FROM r.date) = v_cur_month
        AND EXTRACT(YEAR  FROM r.date) = v_cur_year
      GROUP BY b.name
      ORDER BY SUM(r.production_kwh) DESC NULLS LAST
      LIMIT 1
    ),
    'lowest_site', (
      SELECT b.name FROM admin_solar_readings r
      JOIN admin_solar_branches b ON b.id = r.branch_id AND b.is_active = true
      WHERE EXTRACT(MONTH FROM r.date) = v_cur_month
        AND EXTRACT(YEAR  FROM r.date) = v_cur_year
      GROUP BY b.name
      ORDER BY SUM(r.production_kwh) ASC NULLS LAST
      LIMIT 1
    )
  )
  INTO v_solar;

  -- ── UTILITIES ────────────────────────────────────────────────────
  SELECT jsonb_build_object(
    'locations_tracked', (SELECT COUNT(DISTINCT location_id) FROM admin_utility_readings),
    'total_bill', (
      SELECT COALESCE(ROUND(SUM(bill_amount_pkr), 0), 0) FROM admin_utility_readings
      WHERE EXTRACT(MONTH FROM reading_date) = v_cur_month
        AND EXTRACT(YEAR  FROM reading_date) = v_cur_year
        AND bill_amount_pkr IS NOT NULL
    ),
    'missing_readings', (
      -- locations that have EVER had a reading but have none this month
      SELECT COUNT(*) FROM (
        SELECT DISTINCT location_id FROM admin_utility_readings
      ) tracked
      WHERE NOT EXISTS (
        SELECT 1 FROM admin_utility_readings u
        WHERE u.location_id = tracked.location_id
          AND EXTRACT(MONTH FROM u.reading_date) = v_cur_month
          AND EXTRACT(YEAR  FROM u.reading_date) = v_cur_year
      )
    ),
    'highest_bill_site', (
      SELECT al.name FROM admin_utility_readings u
      JOIN admin_locations al ON al.id = u.location_id
      WHERE EXTRACT(MONTH FROM u.reading_date) = v_cur_month
        AND EXTRACT(YEAR  FROM u.reading_date) = v_cur_year
        AND u.bill_amount_pkr IS NOT NULL
      GROUP BY al.name
      ORDER BY SUM(u.bill_amount_pkr) DESC NULLS LAST
      LIMIT 1
    )
  )
  INTO v_utilities;

  RETURN jsonb_build_object(
    'tasks',       v_tasks,
    'compliance',  v_compliance,
    'payments',    v_payments,
    'documents',   v_documents,
    'fleet',       v_fleet,
    'solar',       v_solar,
    'utilities',   v_utilities
  );
END;
$$;
