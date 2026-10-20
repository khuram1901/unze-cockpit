-- Migration 284: RPC to fetch last present hours for a generator
-- Purpose: Daily-entry page calls this when operator selects a generator.
--          Returns the present_hours from the most recent non-deleted fuel log entry.
--          The UI shows this as a locked "Previous Hours" field — operator cannot edit it.
--
-- Applied manually via Supabase SQL Editor
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.get_generator_last_present_hours(uuid);

CREATE OR REPLACE FUNCTION public.get_generator_last_present_hours(
  p_generator_id uuid
)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fl.present_hours
  FROM   generator_fuel_log fl
  WHERE  fl.generator_id = p_generator_id
    AND  fl.is_deleted   = false
  ORDER  BY fl.refuel_date DESC, fl.created_at DESC
  LIMIT  1;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_generator_last_present_hours(uuid) TO authenticated;

-- Verify (replace with a real generator_id to test)
-- SELECT get_generator_last_present_hours('fd9bbf68-bda5-403d-abb4-693bada6dd92');

SELECT 'get_generator_last_present_hours RPC created' AS status;
