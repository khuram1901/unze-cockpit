-- ============================================================
-- 155: Merge Head Offices → single "Head Office" entry,
--      add can_manage_locations permission, grant to Akhlaq
--      and Sunaina.
--
-- Apply in Supabase SQL Editor — do NOT auto-run.
-- ============================================================

-- 1) Keep 61-XX as the canonical "Head Office", retire 62-XX
UPDATE admin_locations
SET name = 'Head Office'
WHERE entity = 'IFPL' AND name = 'Head Office 61-XX';

-- Soft-delete the duplicate; its linked data (registrations etc.)
-- is preserved in the DB but won't appear in active location lists.
UPDATE admin_locations
SET is_active = false
WHERE entity = 'IFPL' AND name = 'Head Office 62-XX';

-- 2) Add can_manage_locations permission column
ALTER TABLE member_permissions
  ADD COLUMN IF NOT EXISTS can_manage_locations boolean DEFAULT false;

-- 3) Grant to Akhlaq and Sunaina
UPDATE member_permissions mp
SET can_manage_locations = true
FROM members m
WHERE mp.member_id = m.id
  AND LOWER(m.email) IN ('akhlaq@unze.co.uk', 'sunaina@unze.co.uk');
