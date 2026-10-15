-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 265 — Visitor Log RPCs and views
-- All aggregations happen here; the app only displays results.
-- Every function: SECURITY DEFINER + SET search_path = public
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. lookup_visitor — autofill by CNIC or mobile ───────────────────────────
-- Returns the most recent visit for this visitor, plus any flag.
CREATE OR REPLACE FUNCTION public.lookup_visitor(
  p_cnic   text DEFAULT NULL,
  p_mobile text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row visitor_log%ROWTYPE;
  v_flag visitor_flags%ROWTYPE;
  result jsonb;
BEGIN
  -- Find most recent visit by CNIC (preferred) or mobile
  IF p_cnic IS NOT NULL THEN
    SELECT * INTO v_row
    FROM visitor_log
    WHERE cnic = p_cnic AND NOT is_deleted
    ORDER BY time_in DESC LIMIT 1;
  ELSIF p_mobile IS NOT NULL THEN
    SELECT * INTO v_row
    FROM visitor_log
    WHERE mobile = p_mobile AND NOT is_deleted
    ORDER BY time_in DESC LIMIT 1;
  END IF;

  -- Check flag
  IF p_cnic IS NOT NULL THEN
    SELECT * INTO v_flag FROM visitor_flags WHERE cnic = p_cnic LIMIT 1;
  END IF;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('found', false, 'flag', v_flag.flag_type);
  END IF;

  result := jsonb_build_object(
    'found',           true,
    'visitor_name',    v_row.visitor_name,
    'mobile',          v_row.mobile,
    'cnic',            v_row.cnic,
    'department_name', v_row.department_name,
    'host_member_id',  v_row.host_member_id,
    'host_name',       v_row.host_name,
    'purpose',         v_row.purpose,
    'flag',            v_flag.flag_type,
    'flag_reason',     v_flag.reason
  );
  RETURN result;
END;
$$;

-- ── 2. visitor_list_paged — table view for admin tab ────────────────────────
CREATE OR REPLACE FUNCTION public.visitor_list_paged(
  p_date_from  date     DEFAULT NULL,
  p_date_to    date     DEFAULT NULL,
  p_department text     DEFAULT NULL,
  p_search     text     DEFAULT NULL,
  p_status     text     DEFAULT NULL,   -- 'inside' | 'checked_out' | NULL=all
  p_limit      integer  DEFAULT 50,
  p_offset     integer  DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows  jsonb;
  v_total integer;
BEGIN
  -- Total count
  SELECT COUNT(*)::integer INTO v_total
  FROM visitor_log vl
  WHERE NOT vl.is_deleted
    AND (p_date_from IS NULL OR vl.visit_date >= p_date_from)
    AND (p_date_to   IS NULL OR vl.visit_date <= p_date_to)
    AND (p_department IS NULL OR LOWER(vl.department_name) = LOWER(p_department))
    AND (p_status IS NULL
         OR (p_status = 'inside'       AND vl.time_out IS NULL)
         OR (p_status = 'checked_out'  AND vl.time_out IS NOT NULL))
    AND (p_search IS NULL OR
         LOWER(vl.visitor_name) LIKE '%' || LOWER(p_search) || '%' OR
         vl.mobile LIKE '%' || p_search || '%' OR
         (vl.cnic IS NOT NULL AND vl.cnic LIKE '%' || p_search || '%') OR
         LOWER(vl.host_name) LIKE '%' || LOWER(p_search) || '%');

  -- Rows (mask CNIC and mobile for display)
  SELECT jsonb_agg(r ORDER BY r.time_in DESC)
  INTO v_rows
  FROM (
    SELECT
      vl.id,
      vl.visit_date,
      vl.time_in,
      vl.time_out,
      vl.visitor_name,
      -- Masked mobile: +92 3XX XXXX XXX → first 7 chars + ****
      LEFT(vl.mobile, 7) || '****'                               AS mobile_masked,
      -- Masked CNIC: 12345-1234567-1 formatted
      CASE WHEN vl.cnic IS NOT NULL THEN
        LEFT(vl.cnic, 5) || '-' || SUBSTRING(vl.cnic, 6, 7) || '-' || RIGHT(vl.cnic, 1)
      END                                                         AS cnic_masked,
      vl.department_name,
      vl.host_name,
      vl.purpose,
      vl.purpose_other,
      vl.comments,
      -- Duration in minutes (NULL if still inside)
      CASE WHEN vl.time_out IS NOT NULL THEN
        EXTRACT(EPOCH FROM (vl.time_out - vl.time_in)) / 60
      END::integer                                                AS duration_mins,
      (vl.time_out IS NULL)                                       AS is_inside,
      -- Flag
      vf.flag_type,
      -- Entered by name
      em.full_name                                                AS entered_by_name,
      vl.created_at
    FROM visitor_log vl
    LEFT JOIN visitor_flags vf ON vl.cnic IS NOT NULL AND vf.cnic = vl.cnic
    LEFT JOIN members em ON em.id = vl.entered_by
    WHERE NOT vl.is_deleted
      AND (p_date_from IS NULL OR vl.visit_date >= p_date_from)
      AND (p_date_to   IS NULL OR vl.visit_date <= p_date_to)
      AND (p_department IS NULL OR LOWER(vl.department_name) = LOWER(p_department))
      AND (p_status IS NULL
           OR (p_status = 'inside'       AND vl.time_out IS NULL)
           OR (p_status = 'checked_out'  AND vl.time_out IS NOT NULL))
      AND (p_search IS NULL OR
           LOWER(vl.visitor_name) LIKE '%' || LOWER(p_search) || '%' OR
           vl.mobile LIKE '%' || p_search || '%' OR
           (vl.cnic IS NOT NULL AND vl.cnic LIKE '%' || p_search || '%') OR
           LOWER(vl.host_name) LIKE '%' || LOWER(p_search) || '%')
    ORDER BY vl.time_in DESC
    LIMIT p_limit OFFSET p_offset
  ) r;

  RETURN jsonb_build_object(
    'rows',  COALESCE(v_rows, '[]'::jsonb),
    'total', v_total
  );
END;
$$;

-- ── 3. visitor_kpi — dashboard KPI cards ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.visitor_kpi(
  p_date_from date DEFAULT NULL,
  p_date_to   date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today     date := (now() AT TIME ZONE 'Asia/Karachi')::date;
  v_from      date := COALESCE(p_date_from, v_today);
  v_to        date := COALESCE(p_date_to,   v_today);
  v_total     integer;
  v_inside    integer;
  v_overstay  integer;
  v_unique_v  integer;
  v_avg_mins  numeric;
  v_settings  visitor_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_settings FROM visitor_settings WHERE id = 1;

  SELECT
    COUNT(*)                                                                             AS total,
    COUNT(*) FILTER (WHERE time_out IS NULL)                                             AS inside,
    COUNT(*) FILTER (WHERE time_out IS NULL
      AND EXTRACT(EPOCH FROM (now() - time_in))/60 > v_settings.overstay_threshold_mins) AS overstay,
    COUNT(DISTINCT COALESCE(cnic, mobile))                                               AS unique_visitors,
    AVG(CASE WHEN time_out IS NOT NULL THEN
          EXTRACT(EPOCH FROM (time_out - time_in))/60
        END)                                                                             AS avg_mins
  INTO v_total, v_inside, v_overstay, v_unique_v, v_avg_mins
  FROM visitor_log
  WHERE NOT is_deleted
    AND visit_date BETWEEN v_from AND v_to;

  RETURN jsonb_build_object(
    'total',           COALESCE(v_total, 0),
    'currently_inside',COALESCE(v_inside, 0),
    'overstay',        COALESCE(v_overstay, 0),
    'unique_visitors', COALESCE(v_unique_v, 0),
    'avg_duration_mins', ROUND(COALESCE(v_avg_mins, 0))
  );
END;
$$;

-- ── 4. visitor_dept_summary — league table by dept/host ─────────────────────
CREATE OR REPLACE FUNCTION public.visitor_dept_summary(
  p_date_from date DEFAULT NULL,
  p_date_to   date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Karachi')::date;
  v_from  date := COALESCE(p_date_from, date_trunc('month', v_today)::date);
  v_to    date := COALESCE(p_date_to,   v_today);
  v_dept  jsonb;
  v_host  jsonb;
BEGIN
  -- By department
  SELECT jsonb_agg(r ORDER BY r.total DESC)
  INTO v_dept
  FROM (
    SELECT
      department_name,
      COUNT(*)                                            AS total,
      COUNT(*) FILTER (WHERE time_out IS NULL)            AS inside,
      ROUND(AVG(CASE WHEN time_out IS NOT NULL THEN
        EXTRACT(EPOCH FROM (time_out - time_in))/60 END)) AS avg_mins
    FROM visitor_log
    WHERE NOT is_deleted AND visit_date BETWEEN v_from AND v_to
    GROUP BY department_name
  ) r;

  -- By host
  SELECT jsonb_agg(r ORDER BY r.total DESC)
  INTO v_host
  FROM (
    SELECT
      host_name,
      department_name,
      COUNT(*)                                            AS total,
      COUNT(*) FILTER (WHERE time_out IS NULL)            AS inside,
      ROUND(AVG(CASE WHEN time_out IS NOT NULL THEN
        EXTRACT(EPOCH FROM (time_out - time_in))/60 END)) AS avg_mins
    FROM visitor_log
    WHERE NOT is_deleted AND visit_date BETWEEN v_from AND v_to
    GROUP BY host_name, department_name
  ) r;

  RETURN jsonb_build_object(
    'by_department', COALESCE(v_dept, '[]'::jsonb),
    'by_host',       COALESCE(v_host, '[]'::jsonb)
  );
END;
$$;

-- ── 5. visitor_peak_hours — heat map data (hour × day-of-week) ──────────────
CREATE OR REPLACE FUNCTION public.visitor_peak_hours(
  p_date_from date DEFAULT NULL,
  p_date_to   date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Karachi')::date;
  v_from  date := COALESCE(p_date_from, v_today - 30);
  v_to    date := COALESCE(p_date_to,   v_today);
  v_rows  jsonb;
BEGIN
  SELECT jsonb_agg(r)
  INTO v_rows
  FROM (
    SELECT
      EXTRACT(DOW  FROM time_in AT TIME ZONE 'Asia/Karachi')::integer AS dow,  -- 0=Sun
      EXTRACT(HOUR FROM time_in AT TIME ZONE 'Asia/Karachi')::integer AS hour,
      COUNT(*)::integer                                                AS visits
    FROM visitor_log
    WHERE NOT is_deleted AND visit_date BETWEEN v_from AND v_to
    GROUP BY dow, hour
    ORDER BY dow, hour
  ) r;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$$;

-- ── 6. visitor_exceptions — overstay + flagged visitors ─────────────────────
CREATE OR REPLACE FUNCTION public.visitor_exceptions(
  p_date_from date DEFAULT NULL,
  p_date_to   date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today    date := (now() AT TIME ZONE 'Asia/Karachi')::date;
  v_from     date := COALESCE(p_date_from, v_today);
  v_to       date := COALESCE(p_date_to,   v_today);
  v_settings visitor_settings%ROWTYPE;
  v_rows     jsonb;
BEGIN
  SELECT * INTO v_settings FROM visitor_settings WHERE id = 1;

  SELECT jsonb_agg(r ORDER BY r.time_in)
  INTO v_rows
  FROM (
    SELECT
      vl.id,
      vl.visitor_name,
      LEFT(vl.mobile, 7) || '****'                    AS mobile_masked,
      vl.department_name,
      vl.host_name,
      vl.time_in,
      vl.time_out,
      vf.flag_type,
      CASE
        WHEN vl.time_out IS NULL
         AND EXTRACT(EPOCH FROM (now() - vl.time_in))/60 > v_settings.overstay_threshold_mins
        THEN 'overstay'
        WHEN vf.flag_type IS NOT NULL THEN 'flag'
        ELSE NULL
      END AS exception_type,
      ROUND(EXTRACT(EPOCH FROM (now() - vl.time_in))/60)::integer AS mins_inside
    FROM visitor_log vl
    LEFT JOIN visitor_flags vf ON vl.cnic IS NOT NULL AND vf.cnic = vl.cnic
    WHERE NOT vl.is_deleted
      AND vl.visit_date BETWEEN v_from AND v_to
      AND (
        -- Currently overstaying
        (vl.time_out IS NULL
         AND EXTRACT(EPOCH FROM (now() - vl.time_in))/60 > v_settings.overstay_threshold_mins)
        OR
        -- Flagged visitor
        vf.flag_type IS NOT NULL
      )
  ) r;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$$;

-- ── 7. visitor_checkout — record checkout time ──────────────────────────────
CREATE OR REPLACE FUNCTION public.visitor_checkout(
  p_visitor_id uuid,
  p_time_out   timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id uuid;
BEGIN
  -- Caller must be authenticated
  SELECT id INTO v_member_id FROM members WHERE user_id = auth.uid() AND active = true LIMIT 1;
  IF v_member_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Only check out open visits
  UPDATE visitor_log
  SET time_out = p_time_out,
      checked_out_by = v_member_id,
      updated_at = now()
  WHERE id = p_visitor_id
    AND time_out IS NULL
    AND NOT is_deleted;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visitor not found or already checked out';
  END IF;

  -- Audit
  INSERT INTO visitor_audit_log (visitor_id, changed_by, change_type, new_values)
  VALUES (p_visitor_id, v_member_id, 'checkout', jsonb_build_object('time_out', p_time_out));
END;
$$;

-- ── 8. visitor_departments_hosts — for form dropdowns ───────────────────────
CREATE OR REPLACE FUNCTION public.visitor_departments_hosts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_depts jsonb;
  v_hosts jsonb;
BEGIN
  -- Distinct departments from visitor_log + members (active only)
  SELECT jsonb_agg(DISTINCT d ORDER BY d)
  INTO v_depts
  FROM (
    SELECT DISTINCT department_name AS d FROM visitor_log WHERE NOT is_deleted AND department_name <> ''
    UNION
    SELECT DISTINCT department AS d FROM members WHERE active = true AND department IS NOT NULL AND department <> ''
  ) q;

  -- Active members as hosts
  SELECT jsonb_agg(r ORDER BY r.full_name)
  INTO v_hosts
  FROM (
    SELECT id::text, full_name, department
    FROM members
    WHERE active = true AND full_name IS NOT NULL
  ) r;

  RETURN jsonb_build_object(
    'departments', COALESCE(v_depts, '[]'::jsonb),
    'hosts',       COALESCE(v_hosts, '[]'::jsonb)
  );
END;
$$;

-- ── 9. visitor_settings_get — public read for authorised callers ─────────────
CREATE OR REPLACE FUNCTION public.visitor_settings_get()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (SELECT row_to_json(s)::jsonb FROM visitor_settings s WHERE id = 1);
END;
$$;
