-- Migration 278: fix CNIC/mobile unmasking in visitor_list_paged
-- Applied: 2026-10-18
--
-- Root cause: visitor_list_paged is called via the service-role key
-- (createServiceClient), so auth.email() returns null inside the function.
-- is_admin_tier() → get_user_role() → falls back to 'Member' for everyone.
-- Result: all callers got masked CNIC/mobile, even Admin and CEO.
--
-- Fix: add p_caller_email parameter. The API route passes auth.email from
-- the Bearer token. The function resolves the role directly from members,
-- bypassing auth.email() which is unreliable under service role.

CREATE OR REPLACE FUNCTION public.visitor_list_paged(
  p_date_from    date    DEFAULT NULL,
  p_date_to      date    DEFAULT NULL,
  p_department   text    DEFAULT NULL,
  p_search       text    DEFAULT NULL,
  p_status       text    DEFAULT NULL,
  p_limit        integer DEFAULT 50,
  p_offset       integer DEFAULT 0,
  p_caller_email text    DEFAULT NULL   -- NEW: passed by API route
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_rows        jsonb;
  v_total       integer;
  v_role        text;
  v_can_unmask  boolean;
BEGIN
  -- Resolve caller role from members table (works under service role)
  SELECT COALESCE(m.role, 'Member')
    INTO v_role
    FROM members m
   WHERE LOWER(m.email) = LOWER(p_caller_email)
   LIMIT 1;

  -- Admin and CEO see full CNIC + mobile; everyone else gets masked
  v_can_unmask := v_role IN ('Admin', 'CEO');

  SELECT COUNT(*)::integer INTO v_total
  FROM visitor_log vl
  WHERE NOT vl.is_deleted
    AND (p_date_from   IS NULL OR vl.visit_date >= p_date_from)
    AND (p_date_to     IS NULL OR vl.visit_date <= p_date_to)
    AND (p_department  IS NULL OR LOWER(vl.department_name) = LOWER(p_department))
    AND (p_status IS NULL
         OR (p_status = 'inside'      AND vl.time_out IS NULL)
         OR (p_status = 'checked_out' AND vl.time_out IS NOT NULL))
    AND (p_search IS NULL OR
         LOWER(vl.visitor_name) LIKE '%' || LOWER(p_search) || '%' OR
         vl.mobile LIKE '%' || p_search || '%' OR
         (vl.cnic IS NOT NULL AND vl.cnic LIKE '%' || p_search || '%') OR
         LOWER(vl.host_name) LIKE '%' || LOWER(p_search) || '%');

  SELECT jsonb_agg(r ORDER BY r.time_in DESC)
  INTO v_rows
  FROM (
    SELECT
      vl.id,
      vl.visit_date,
      vl.time_in,
      vl.time_out,
      vl.visitor_name,

      -- Mobile: full for Admin/CEO, partially masked for others
      CASE WHEN v_can_unmask
        THEN vl.mobile
        ELSE LEFT(vl.mobile, 7) || '****'
      END                                                       AS mobile_masked,

      -- CNIC: full formatted for Admin/CEO, province+district only for others
      CASE
        WHEN vl.cnic IS NULL  THEN NULL
        WHEN v_can_unmask     THEN
          LEFT(vl.cnic, 5) || '-' || SUBSTRING(vl.cnic, 6, 7) || '-' || RIGHT(vl.cnic, 1)
        ELSE
          LEFT(vl.cnic, 5) || '-XXXXXXX-X'
      END                                                       AS cnic_masked,

      vl.department_name,
      vl.host_name,
      vl.purpose,
      vl.purpose_other,
      vl.comments,
      CASE WHEN vl.time_out IS NOT NULL THEN
        EXTRACT(EPOCH FROM (vl.time_out - vl.time_in)) / 60
      END::integer                                              AS duration_mins,
      (vl.time_out IS NULL)                                     AS is_inside,
      vf.flag_type,
      em.name                                                   AS entered_by_name,
      vl.created_at
    FROM visitor_log vl
    LEFT JOIN visitor_flags vf ON vl.cnic IS NOT NULL AND vf.cnic = vl.cnic
    LEFT JOIN members em ON em.id = vl.entered_by
    WHERE NOT vl.is_deleted
      AND (p_date_from   IS NULL OR vl.visit_date >= p_date_from)
      AND (p_date_to     IS NULL OR vl.visit_date <= p_date_to)
      AND (p_department  IS NULL OR LOWER(vl.department_name) = LOWER(p_department))
      AND (p_status IS NULL
           OR (p_status = 'inside'      AND vl.time_out IS NULL)
           OR (p_status = 'checked_out' AND vl.time_out IS NOT NULL))
      AND (p_search IS NULL OR
           LOWER(vl.visitor_name) LIKE '%' || LOWER(p_search) || '%' OR
           vl.mobile LIKE '%' || p_search || '%' OR
           (vl.cnic IS NOT NULL AND vl.cnic LIKE '%' || p_search || '%') OR
           LOWER(vl.host_name) LIKE '%' || LOWER(p_search) || '%')
    ORDER BY vl.time_in DESC
    LIMIT p_limit OFFSET p_offset
  ) r;

  RETURN jsonb_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'total', v_total);
END;
$$;
