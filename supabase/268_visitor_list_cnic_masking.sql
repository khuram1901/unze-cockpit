-- Migration 268: per-role CNIC and mobile masking in visitor_list_paged
-- Applied: 2026-10-15
--
-- Before: cnic_masked showed full formatted CNIC to all users.
--         mobile_masked was partially masked for all users equally.
-- After:  users with is_admin_tier() OR has_widget('admin_ops.visitors')
--         see full CNIC (42201-1234567-1) and full mobile (+923001234567).
--         All others see masked CNIC (42201-XXXXXXX-X) and masked mobile
--         (+923001****). Field names unchanged — no app code changes needed.

CREATE OR REPLACE FUNCTION public.visitor_list_paged(
  p_date_from   date    DEFAULT NULL,
  p_date_to     date    DEFAULT NULL,
  p_department  text    DEFAULT NULL,
  p_search      text    DEFAULT NULL,
  p_status      text    DEFAULT NULL,
  p_limit       integer DEFAULT 50,
  p_offset      integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_rows        jsonb;
  v_total       integer;
  v_can_unmask  boolean;
BEGIN
  -- Resolve once; used in both SELECT and search WHERE
  v_can_unmask := is_admin_tier() OR has_widget('admin_ops.visitors');

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

      -- Mobile: full for admins, partially masked for others
      CASE WHEN v_can_unmask
        THEN vl.mobile
        ELSE LEFT(vl.mobile, 7) || '****'
      END                                                       AS mobile_masked,

      -- CNIC: full formatted for admins, province+district only for others
      CASE
        WHEN vl.cnic IS NULL       THEN NULL
        WHEN v_can_unmask          THEN
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
