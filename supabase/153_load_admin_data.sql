-- ─────────────────────────────────────────────────────────────────────
-- Migration 153 — Load real data from Admin Dashboard 2025-2026.xlsx
-- Apply via Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────────────

-- ── Part 1: EOBI Registration Status ───────────────────────────────────
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Head Office 61-XX' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'DHA' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Liberty Store' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Lake City' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Mall of Multan' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'LDS Jhang' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Giga Mall' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Capital Square' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Gujranwala' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Faisalabad' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Amanah Mall' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Emporium Mall' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Packages Mall' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Packages Mall Mega Store' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Iqbal Town' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Rahim Yar Khan' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Sahiwal' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Bahria Town' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'V Mall Sialkot' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Hurrianwala' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Kooh I Noor' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Usman Mall' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Capital Square' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Hakim Mall' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Sufi City' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Kharian' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Sialkot Store' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Pending', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Warehouse' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Pending', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Manga Warehouse' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Tariq Road' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Hyderabad' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Pending', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Lucky One Mall' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Dolmen Mall' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Pending', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Sukkur' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Peshawar 1' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Swat' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Mardan' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Raya' AND l.entity = 'Baranh';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Raya' AND l.entity = 'Baranh';
UPDATE admin_registrations r
  SET status = 'Pending', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'DHA Y Block' AND l.entity = 'Baranh';
UPDATE admin_registrations r
  SET status = 'Pending', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'DHA Y Block' AND l.entity = 'HD';
UPDATE admin_registrations r
  SET status = 'Pending', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Packages Mall' AND l.entity = 'Baranh';
UPDATE admin_registrations r
  SET status = 'Pending', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Packages Mall' AND l.entity = 'HD';
UPDATE admin_registrations r
  SET status = 'Pending', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Dolmen Mall' AND l.entity = 'HD';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Gulberg' AND l.entity = 'Baranh';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Jhang' AND l.entity = 'Baranh';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Elysian Sweets' AND l.entity = 'Baranh';
UPDATE admin_registrations r
  SET status = 'Pending', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Restaurant Warehouse' AND l.entity = 'Baranh';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Meter Factory' AND l.entity = 'UTPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'MEPCO' AND l.entity = 'UTPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'PESCO' AND l.entity = 'UTPL';
UPDATE admin_registrations r
  SET status = 'Pending', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'FIEDMC' AND l.entity = 'UTPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'BINC' AND l.entity = 'UTPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'EOBI'
    AND l.name = 'Head Office 62-XX' AND l.entity = 'IFPL';

-- ── Part 2: Social Security Registration Status ─────────────────────────
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Head Office 61-XX' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'DHA' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Liberty Store' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Lake City' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Mall of Multan' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'LDS Jhang' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Sialkot Store' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Giga Mall' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Capital Square' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Gujranwala' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Faisalabad' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Amanah Mall' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Emporium Mall' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Packages Mall' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Packages Mall Mega Store' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Iqbal Town' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Rahim Yar Khan' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Sahiwal' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Bahria Town' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'V Mall Sialkot' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Hurrianwala' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Kooh I Noor' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Usman Mall' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Pending', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Capital Square' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Hakim Mall' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Sufi City' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Pending', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Kharian' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Warehouse' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Pending', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Manga Warehouse' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Tariq Road' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Hyderabad' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Lucky One Mall' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Dolmen Mall' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Pending', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Sukkur' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Peshawar 1' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Pending', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Swat' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Mardan' AND l.entity = 'IFPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Raya' AND l.entity = 'Baranh';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Raya' AND l.entity = 'Baranh';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Gulberg' AND l.entity = 'Baranh';
UPDATE admin_registrations r
  SET status = 'Pending', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'DHA Y Block' AND l.entity = 'Baranh';
UPDATE admin_registrations r
  SET status = 'Pending', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'DHA Y Block' AND l.entity = 'HD';
UPDATE admin_registrations r
  SET status = 'Pending', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Packages Mall' AND l.entity = 'Baranh';
UPDATE admin_registrations r
  SET status = 'Pending', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Packages Mall' AND l.entity = 'HD';
UPDATE admin_registrations r
  SET status = 'Pending', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Dolmen Mall' AND l.entity = 'HD';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Jhang' AND l.entity = 'Baranh';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Elysian Sweets' AND l.entity = 'Baranh';
UPDATE admin_registrations r
  SET status = 'Pending', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Restaurant Warehouse' AND l.entity = 'Baranh';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'Meter Factory' AND l.entity = 'UTPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'MEPCO' AND l.entity = 'UTPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'PESCO' AND l.entity = 'UTPL';
UPDATE admin_registrations r
  SET status = 'Pending', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'FIEDMC' AND l.entity = 'UTPL';
UPDATE admin_registrations r
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE r.location_id = l.id AND r.registration_type = 'Social Security'
    AND l.name = 'BINC' AND l.entity = 'UTPL';

-- ── Part 3: Civil Defence Compliance ───────────────────────────────────
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Head Office 61-XX' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'DHA' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Liberty Store' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Lake City' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Mall of Multan' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'LDS Jhang' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Sialkot Store' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Giga Mall' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Capital Square' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Gujranwala' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Faisalabad' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Amanah Mall' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Emporium Mall' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Packages Mall' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Packages Mall Mega Store' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Iqbal Town' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Rahim Yar Khan' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Sahiwal' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Bahria Town' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'V Mall Sialkot' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Hurrianwala' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Kooh I Noor' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Usman Mall' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Capital Square' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Hakim Mall' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Sufi City' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Kharian' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Warehouse' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Manga Warehouse' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Tariq Road' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Hyderabad' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Lucky One Mall' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Dolmen Mall' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Peshawar 1' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Swat' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Mardan' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Raya' AND l.entity = 'Baranh';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Raya' AND l.entity = 'Baranh';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Gulberg' AND l.entity = 'Baranh';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'DHA Y Block' AND l.entity = 'Baranh';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'DHA Y Block' AND l.entity = 'HD';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Packages Mall' AND l.entity = 'Baranh';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Packages Mall' AND l.entity = 'HD';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Dolmen Mall' AND l.entity = 'HD';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Jhang' AND l.entity = 'Baranh';
UPDATE admin_compliance c
  SET status = 'Inprocess', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Elysian Sweets' AND l.entity = 'Baranh';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Restaurant Warehouse' AND l.entity = 'Baranh';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'Meter Factory' AND l.entity = 'UTPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'MEPCO' AND l.entity = 'UTPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'PESCO' AND l.entity = 'UTPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Civil Defence'
    AND l.name = 'FIEDMC' AND l.entity = 'UTPL';

-- ── Part 4: Labour Registration Compliance ──────────────────────────────
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Head Office 61-XX' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'DHA' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Liberty Store' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Lake City' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Mall of Multan' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'LDS Jhang' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Giga Mall' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Capital Square' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Gujranwala' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Faisalabad' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Amanah Mall' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Emporium Mall' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Packages Mall' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Packages Mall Mega Store' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Iqbal Town' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Rahim Yar Khan' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Sahiwal' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Bahria Town' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'V Mall Sialkot' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Hurrianwala' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Kooh I Noor' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Usman Mall' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Capital Square' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Hakim Mall' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Sufi City' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Kharian' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Sialkot Store' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Warehouse' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Manga Warehouse' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Tariq Road' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Hyderabad' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Lucky One Mall' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Dolmen Mall' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Sukkur' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Peshawar 1' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Swat' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Mardan' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Raya' AND l.entity = 'Baranh';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Raya' AND l.entity = 'Baranh';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'DHA Y Block' AND l.entity = 'Baranh';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'DHA Y Block' AND l.entity = 'HD';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Packages Mall' AND l.entity = 'Baranh';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Packages Mall' AND l.entity = 'HD';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Dolmen Mall' AND l.entity = 'HD';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Gulberg' AND l.entity = 'Baranh';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Jhang' AND l.entity = 'Baranh';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Elysian Sweets' AND l.entity = 'Baranh';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Restaurant Warehouse' AND l.entity = 'Baranh';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'Meter Factory' AND l.entity = 'UTPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'MEPCO' AND l.entity = 'UTPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'PESCO' AND l.entity = 'UTPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'FIEDMC' AND l.entity = 'UTPL';
UPDATE admin_compliance c
  SET status = 'N/A', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Registration'
    AND l.name = 'BINC' AND l.entity = 'UTPL';

-- ── Part 5: Labour Inspection Compliance ────────────────────────────────
UPDATE admin_compliance c
  SET status = 'Pending', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Head Office 61-XX' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'DHA' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Liberty Store' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Lake City' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Mall of Multan' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'LDS Jhang' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Giga Mall' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Capital Square' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Gujranwala' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Faisalabad' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Amanah Mall' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Emporium Mall' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Packages Mall' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Packages Mall Mega Store' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Iqbal Town' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Rahim Yar Khan' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Sahiwal' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Bahria Town' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'V Mall Sialkot' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Hurrianwala' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Kooh I Noor' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Usman Mall' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Capital Square' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Hakim Mall' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Sufi City' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Kharian' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Sialkot Store' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Warehouse' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Manga Warehouse' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Tariq Road' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Hyderabad' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Lucky One Mall' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Dolmen Mall' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Sukkur' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Peshawar 1' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Swat' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Mardan' AND l.entity = 'IFPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Raya' AND l.entity = 'Baranh';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Raya' AND l.entity = 'Baranh';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'DHA Y Block' AND l.entity = 'Baranh';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'DHA Y Block' AND l.entity = 'HD';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Packages Mall' AND l.entity = 'Baranh';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Packages Mall' AND l.entity = 'HD';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Dolmen Mall' AND l.entity = 'HD';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Gulberg' AND l.entity = 'Baranh';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Jhang' AND l.entity = 'Baranh';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Elysian Sweets' AND l.entity = 'Baranh';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Restaurant Warehouse' AND l.entity = 'Baranh';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'Meter Factory' AND l.entity = 'UTPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'MEPCO' AND l.entity = 'UTPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'PESCO' AND l.entity = 'UTPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'FIEDMC' AND l.entity = 'UTPL';
UPDATE admin_compliance c
  SET status = 'Registered', updated_at = now()
  FROM admin_locations l
  WHERE c.location_id = l.id AND c.compliance_type = 'Labour Inspection'
    AND l.name = 'BINC' AND l.entity = 'UTPL';

-- ── Part 6: NTN on WAPDA ───────────────────────────────────────────────
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, '2 Meter', '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=DvAjC0rMLu', 'system@import'
  FROM admin_locations l WHERE l.name = 'Head Office 62-XX' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, '3 Meter', '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=lj5pL0kLxy', 'system@import'
  FROM admin_locations l WHERE l.name = 'Head Office 62-XX' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, '4 Meter', '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=x8QQd0Gyhi', 'system@import'
  FROM admin_locations l WHERE l.name = 'Head Office 62-XX' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, '5 Meter', '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=14lHR0uwHr', 'system@import'
  FROM admin_locations l WHERE l.name = 'Head Office 62-XX' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=YYDAv0vECw', 'system@import'
  FROM admin_locations l WHERE l.name = 'Head Office 61-XX' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, '1 Meter', '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=7sf6n0OBs4', 'system@import'
  FROM admin_locations l WHERE l.name = 'DHA' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, '2 Meter', '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=pp69U0PNtE', 'system@import'
  FROM admin_locations l WHERE l.name = 'DHA' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, '3 Meter', '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=8NuA80zH4H', 'system@import'
  FROM admin_locations l WHERE l.name = 'DHA' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, '4 Meter', '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=dZnmU0Cv0Q', 'system@import'
  FROM admin_locations l WHERE l.name = 'DHA' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, '1 Meter', '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=kSyl30UeX7', 'system@import'
  FROM admin_locations l WHERE l.name = 'Liberty Store' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, '2 Meter', '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=nfR3v0mNMF', 'system@import'
  FROM admin_locations l WHERE l.name = 'Liberty Store' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, NULL, 'N/A', 'https://my.folderit.com/file/view/?uid=cPToN04BZo', 'system@import'
  FROM admin_locations l WHERE l.name = 'Lake City' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, NULL, 'N/A', 'https://my.folderit.com/file/view/?uid=naHN30lzdi', 'system@import'
  FROM admin_locations l WHERE l.name = 'Mall of Multan' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=0xqVe0G0Rn', 'system@import'
  FROM admin_locations l WHERE l.name = 'LDS Jhang' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, NULL, 'N/A', 'https://my.folderit.com/file/view/?uid=pMww30pBqX', 'system@import'
  FROM admin_locations l WHERE l.name = 'Sialkot Store' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, NULL, 'N/A', 'https://my.folderit.com/file/view/?uid=EtvfU0k4WZ', 'system@import'
  FROM admin_locations l WHERE l.name = 'Giga Mall' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, NULL, 'N/A', 'https://my.folderit.com/file/view/?uid=KRRHY0_SgF', 'system@import'
  FROM admin_locations l WHERE l.name = 'Capital Square' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=6Qgwp0G0uF', 'system@import'
  FROM admin_locations l WHERE l.name = 'Gujranwala' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=mQKZn02ZeC', 'system@import'
  FROM admin_locations l WHERE l.name = 'Faisalabad' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, NULL, 'N/A', 'https://my.folderit.com/file/view/?uid=PE3xG0b7YP', 'system@import'
  FROM admin_locations l WHERE l.name = 'Amanah Mall' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=3kcWm0D2L5', 'system@import'
  FROM admin_locations l WHERE l.name = 'Emporium Mall' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=YzaRF0HMmY', 'system@import'
  FROM admin_locations l WHERE l.name = 'Packages Mall' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=HaFk80w6sY', 'system@import'
  FROM admin_locations l WHERE l.name = 'Packages Mall Mega Store' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=_AZwy0uu9J', 'system@import'
  FROM admin_locations l WHERE l.name = 'Iqbal Town' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, NULL, 'N/A', NULL, 'system@import'
  FROM admin_locations l WHERE l.name = 'Rahim Yar Khan' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, NULL, 'Submeter', NULL, 'system@import'
  FROM admin_locations l WHERE l.name = 'Sahiwal' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, NULL, 'N/A', 'https://my.folderit.com/file/view/?uid=X6OLH0CnDC', 'system@import'
  FROM admin_locations l WHERE l.name = 'Bahria Town' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, NULL, 'N/A', 'https://my.folderit.com/file/view/?uid=wb-mJ0FKQy', 'system@import'
  FROM admin_locations l WHERE l.name = 'V Mall Sialkot' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=-jf6V0p-kb', 'system@import'
  FROM admin_locations l WHERE l.name = 'Hurrianwala' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, NULL, 'Submeter', NULL, 'system@import'
  FROM admin_locations l WHERE l.name = 'Kooh I Noor' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=aUlNv0Xv7K', 'system@import'
  FROM admin_locations l WHERE l.name = 'Usman Mall' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, NULL, 'N/A', NULL, 'system@import'
  FROM admin_locations l WHERE l.name = 'Capital Square' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, NULL, 'N/A', NULL, 'system@import'
  FROM admin_locations l WHERE l.name = 'Hakim Mall' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, NULL, 'Pending', 'https://my.folderit.com/file/view/?uid=aDDLb08JCP', 'system@import'
  FROM admin_locations l WHERE l.name = 'Sufi City' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=gb8HQ0GyP3', 'system@import'
  FROM admin_locations l WHERE l.name = 'Kharian' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, '1 Meter', NULL, 'Pending', 'https://my.folderit.com/file/view/?uid=dDcCY0ITCN', 'system@import'
  FROM admin_locations l WHERE l.name = 'Meter Factory' AND l.entity = 'UTPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, '2 Meter', '254852', 'Pending', 'https://my.folderit.com/file/view/?uid=h6eGv0a4yd', 'system@import'
  FROM admin_locations l WHERE l.name = 'Meter Factory' AND l.entity = 'UTPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=BnzA702Wno', 'system@import'
  FROM admin_locations l WHERE l.name = 'Warehouse' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, '2531794-6', 'Done', 'https://my.folderit.com/folder/index/?uid=Woz750_knF', 'system@import'
  FROM admin_locations l WHERE l.name = 'Manga Warehouse' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, NULL, 'Done', 'https://my.folderit.com/file/view/?uid=-f9o00vXQp', 'system@import'
  FROM admin_locations l WHERE l.name = 'Tariq Road' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, NULL, 'N/A', 'https://my.folderit.com/file/view/?uid=Iy-Ub0cBxy', 'system@import'
  FROM admin_locations l WHERE l.name = 'Hyderabad' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, NULL, 'N/A', 'https://my.folderit.com/file/view/?uid=4S3s20D0Jm', 'system@import'
  FROM admin_locations l WHERE l.name = 'Lucky One Mall' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, NULL, 'N/A', 'https://my.folderit.com/file/view/?uid=Tc6E90X31Z', 'system@import'
  FROM admin_locations l WHERE l.name = 'Dolmen Mall' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, NULL, 'Pending', NULL, 'system@import'
  FROM admin_locations l WHERE l.name = 'Sukkur' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=t0m_L0JLG2', 'system@import'
  FROM admin_locations l WHERE l.name = 'Peshawar 1' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, NULL, 'Done', 'https://my.folderit.com/file/view/?uid=73WHW03mcO', 'system@import'
  FROM admin_locations l WHERE l.name = 'Swat' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=WYFBL06wfn', 'system@import'
  FROM admin_locations l WHERE l.name = 'Mardan' AND l.entity = 'IFPL'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, 'A304338-3', 'Done', 'https://my.folderit.com/file/view/?uid=mrq6m0kaDD', 'system@import'
  FROM admin_locations l WHERE l.name = 'Raya' AND l.entity = 'HD'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, 'A304338-3', 'Done', 'https://my.folderit.com/file/view/?uid=rliLa0x3oN', 'system@import'
  FROM admin_locations l WHERE l.name = 'Raya' AND l.entity = 'Baranh'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, 'A304338-3', 'Done', 'https://my.folderit.com/file/view/?uid=LN42t0b2Dn', 'system@import'
  FROM admin_locations l WHERE l.name = 'Gulberg' AND l.entity = 'Baranh'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=V1BfC0kCGQ', 'system@import'
  FROM admin_locations l WHERE l.name = 'Jhang' AND l.entity = 'Baranh'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, '2531794-6', 'Done', 'https://my.folderit.com/file/view/?uid=nROfC0kaam', 'system@import'
  FROM admin_locations l WHERE l.name = 'Elysian Sweets' AND l.entity = 'Baranh'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, 'A304338-3', 'Done', 'https://my.folderit.com/file/view/?uid=rKnWO05-yk', 'system@import'
  FROM admin_locations l WHERE l.name = 'Restaurant Warehouse' AND l.entity = 'Baranh'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, 'A304338-3', 'Done', 'https://my.folderit.com/file/view/?uid=fr49X0mRyY', 'system@import'
  FROM admin_locations l WHERE l.name = 'DHA Y Block' AND l.entity = 'Baranh'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, 'A304338-3', 'Done', 'https://my.folderit.com/file/view/?uid=fr49X0mRyY', 'system@import'
  FROM admin_locations l WHERE l.name = 'DHA Y Block' AND l.entity = 'HD'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, NULL, 'N/A', NULL, 'system@import'
  FROM admin_locations l WHERE l.name = 'Packages Mall' AND l.entity = 'Baranh'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, NULL, 'N/A', NULL, 'system@import'
  FROM admin_locations l WHERE l.name = 'Packages Mall' AND l.entity = 'HD'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_ntn_docs (location_id, meter_label, ntn_number, status, folderit_link, updated_by)
  SELECT l.id, NULL, NULL, 'N/A', NULL, 'system@import'
  FROM admin_locations l WHERE l.name = 'Dolmen Mall' AND l.entity = 'HD'
ON CONFLICT (location_id, meter_label) DO UPDATE
  SET ntn_number = EXCLUDED.ntn_number, status = EXCLUDED.status,
      folderit_link = EXCLUDED.folderit_link, updated_at = now();

-- ── Part 7: Solar Monthly Summary (historical kWh totals) ──────────────

-- ── Part 8: Restaurant Licences ────────────────────────────────────────
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'PFA Licence', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Raya' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Medical Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Raya' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Training Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Raya' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Tourism Certificate', 'Done', 'https://my.folderit.com/file/view/?uid=v8B-w085Y8'
  FROM admin_locations l WHERE l.name = 'Raya' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'PFA Licence', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'DHA Y Block' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Medical Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'DHA Y Block' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Training Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'DHA Y Block' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Tourism Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'DHA Y Block' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'PFA Licence', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'DHA Y Block' AND l.entity = 'HD'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Medical Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'DHA Y Block' AND l.entity = 'HD'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Training Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'DHA Y Block' AND l.entity = 'HD'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Tourism Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'DHA Y Block' AND l.entity = 'HD'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'PFA Licence', 'Done', 'https://my.folderit.com/file/view/?uid=Uncxg0X_FU'
  FROM admin_locations l WHERE l.name = 'Packages Mall' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Medical Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Packages Mall' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Training Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Packages Mall' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Tourism Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Packages Mall' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'PFA Licence', 'Done', 'https://my.folderit.com/file/view/?uid=asPyC0gn2W'
  FROM admin_locations l WHERE l.name = 'Packages Mall' AND l.entity = 'HD'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Medical Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Packages Mall' AND l.entity = 'HD'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Training Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Packages Mall' AND l.entity = 'HD'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Tourism Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Packages Mall' AND l.entity = 'HD'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'PFA Licence', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Dolmen Mall' AND l.entity = 'HD'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Medical Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Dolmen Mall' AND l.entity = 'HD'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Training Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Dolmen Mall' AND l.entity = 'HD'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Tourism Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Dolmen Mall' AND l.entity = 'HD'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'PFA Licence', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Gulberg' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Medical Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Gulberg' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Training Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Gulberg' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Tourism Certificate', 'Done', 'https://my.folderit.com/file/view/?uid=kimc80q2C2'
  FROM admin_locations l WHERE l.name = 'Gulberg' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'PFA Licence', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Gulberg' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Medical Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Gulberg' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Training Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Gulberg' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Tourism Certificate', 'Done', 'https://my.folderit.com/file/view/?uid=iCDm50pmn9'
  FROM admin_locations l WHERE l.name = 'Gulberg' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'PFA Licence', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Jhang' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Medical Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Jhang' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Training Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Jhang' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Tourism Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Jhang' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'PFA Licence', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Elysian Sweets' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Medical Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Elysian Sweets' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Training Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Elysian Sweets' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Tourism Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Elysian Sweets' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'PFA Licence', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Restaurant Warehouse' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Medical Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Restaurant Warehouse' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Training Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Restaurant Warehouse' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();
INSERT INTO admin_restaurant_licences (location_id, licence_type, status, folderit_link)
  SELECT l.id, 'Tourism Certificate', 'Pending', NULL
  FROM admin_locations l WHERE l.name = 'Restaurant Warehouse' AND l.entity = 'Baranh'
ON CONFLICT (location_id, licence_type) DO UPDATE
  SET status = EXCLUDED.status, folderit_link = EXCLUDED.folderit_link, updated_at = now();