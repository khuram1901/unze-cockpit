-- 270: add visit_date to lookup_visitor RPC result
-- So the visitor-entry page can show "Last visited on DD/MM/YYYY to see [host]"

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
    'visit_date',      v_row.visit_date,   -- NEW: last visit date for the banner
    'flag',            v_flag.flag_type,
    'flag_reason',     v_flag.reason
  );
  RETURN result;
END;
$$;
