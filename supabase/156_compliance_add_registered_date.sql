-- ============================================================
-- 156: Add last_renewed (registered date) to compliance RPC
--      for Civil Defence, Labour Registration, Labour Inspection.
--
-- Return type changes → must DROP first.
-- Apply in Supabase SQL Editor — do NOT auto-run.
-- ============================================================

DROP FUNCTION IF EXISTS get_admin_compliance();

CREATE FUNCTION get_admin_compliance()
RETURNS TABLE (
  location_id               uuid,
  name                      text,
  entity                    text,
  civil_defence_status      text,
  civil_defence_registered  date,
  civil_defence_due         date,
  labour_reg_status         text,
  labour_reg_registered     date,
  labour_reg_due            date,
  labour_insp_status        text,
  labour_insp_registered    date,
  labour_insp_due           date
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    l.id,
    l.name,
    l.entity,
    MAX(CASE WHEN c.compliance_type = 'Civil Defence'       THEN c.status       END),
    MAX(CASE WHEN c.compliance_type = 'Civil Defence'       THEN c.last_renewed END)::date,
    MAX(CASE WHEN c.compliance_type = 'Civil Defence'       THEN c.next_due     END)::date,
    MAX(CASE WHEN c.compliance_type = 'Labour Registration' THEN c.status       END),
    MAX(CASE WHEN c.compliance_type = 'Labour Registration' THEN c.last_renewed END)::date,
    MAX(CASE WHEN c.compliance_type = 'Labour Registration' THEN c.next_due     END)::date,
    MAX(CASE WHEN c.compliance_type = 'Labour Inspection'   THEN c.status       END),
    MAX(CASE WHEN c.compliance_type = 'Labour Inspection'   THEN c.last_renewed END)::date,
    MAX(CASE WHEN c.compliance_type = 'Labour Inspection'   THEN c.next_due     END)::date
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
