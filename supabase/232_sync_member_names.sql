-- Migration 232: sync_member_names_from_flw
-- Pushes the corrected full name (EmployeeName + FatherName) from
-- flw_employees → members.name, wherever employee_code links them.
-- Called by the FlowHCM sync route after every employee upsert.
-- Only updates rows where the name has actually changed to avoid
-- unnecessary churn.

CREATE OR REPLACE FUNCTION sync_member_names_from_flw()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE members m
  SET    name = trim(regexp_replace(e.full_name, '\s+', ' ', 'g'))
  FROM   flw_employees e
  WHERE  m.employee_code = e.employee_code
    AND  e.full_name IS NOT NULL
    AND  trim(e.full_name) <> ''
    AND  trim(regexp_replace(e.full_name, '\s+', ' ', 'g'))
         IS DISTINCT FROM coalesce(m.name, '');
END;
$$;

REVOKE EXECUTE ON FUNCTION sync_member_names_from_flw() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION sync_member_names_from_flw() TO service_role;
