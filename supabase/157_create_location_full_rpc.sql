-- ============================================================
-- 157: RPC to create a location + all linked records in one
--      atomic transaction. Also grants can_manage_locations
--      to K. Saleem (khuram1901@gmail.com).
--
-- Apply in Supabase SQL Editor — do NOT auto-run.
-- ============================================================

-- 1) Grant can_manage_locations to K. Saleem
UPDATE member_permissions mp
SET can_manage_locations = true
FROM members m
WHERE mp.member_id = m.id
  AND LOWER(m.email) = 'khuram1901@gmail.com';

-- 2) Full location creation RPC
CREATE OR REPLACE FUNCTION create_admin_location_full(
  p_name                     text,
  p_entity                   text,
  p_location_type            text,
  p_province                 text,
  p_eobi_status              text,
  p_ss_status                text,
  p_civil_defence_status     text,
  p_civil_defence_registered date,
  p_civil_defence_due        date,
  p_labour_reg_status        text,
  p_labour_insp_status       text,
  p_ntn_number               text,
  p_meter_label              text,
  p_created_by               text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Master location
  INSERT INTO admin_locations (name, entity, location_type, province, is_active)
  VALUES (p_name, p_entity, p_location_type, NULLIF(p_province, ''), true)
  RETURNING id INTO v_id;

  -- EOBI registration
  INSERT INTO admin_registrations (location_id, registration_type, status, updated_by, updated_at)
  VALUES (v_id, 'EOBI', COALESCE(NULLIF(p_eobi_status,''), 'Pending'), p_created_by, now());

  -- Social Security registration
  INSERT INTO admin_registrations (location_id, registration_type, status, updated_by, updated_at)
  VALUES (v_id, 'Social Security', COALESCE(NULLIF(p_ss_status,''), 'Pending'), p_created_by, now());

  -- Civil Defence compliance
  INSERT INTO admin_compliance (location_id, compliance_type, status, last_renewed, next_due, updated_by, updated_at)
  VALUES (v_id, 'Civil Defence',
    COALESCE(NULLIF(p_civil_defence_status,''), 'Pending'),
    p_civil_defence_registered, p_civil_defence_due, p_created_by, now());

  -- Labour Registration compliance
  INSERT INTO admin_compliance (location_id, compliance_type, status, updated_by, updated_at)
  VALUES (v_id, 'Labour Registration',
    COALESCE(NULLIF(p_labour_reg_status,''), 'Pending'), p_created_by, now());

  -- Labour Inspection compliance
  INSERT INTO admin_compliance (location_id, compliance_type, status, updated_by, updated_at)
  VALUES (v_id, 'Labour Inspection',
    COALESCE(NULLIF(p_labour_insp_status,''), 'Pending'), p_created_by, now());

  -- NTN document (only if NTN number provided)
  IF p_ntn_number IS NOT NULL AND trim(p_ntn_number) != '' THEN
    INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, updated_at)
    VALUES (v_id,
      COALESCE(NULLIF(trim(p_meter_label),''), 'Meter 1'),
      trim(p_ntn_number), 'Done', now());
  END IF;

  RETURN v_id;
END;
$$;
