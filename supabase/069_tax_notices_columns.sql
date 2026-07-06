-- 069_tax_notices_columns.sql
-- Add Active/Inactive, Status and Stage fields to legal_notices
-- Add can_manage_tax_notices permission column

-- Step 2a: New columns on legal_notices
ALTER TABLE legal_notices
  ADD COLUMN IF NOT EXISTS is_active      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notice_status  text CHECK (notice_status IN ('Order', 'Notice', 'Show Cause')),
  ADD COLUMN IF NOT EXISTS legal_stage    text CHECK (legal_stage IN ('Authority', 'Department', 'CIR Appeal', 'Tribunal', 'High Court', 'Supreme Court'));

-- Step 2b: New permission column
ALTER TABLE member_permissions
  ADD COLUMN IF NOT EXISTS can_manage_tax_notices boolean DEFAULT NULL;

-- Step 2c: Grant to Khuram, Shakeel, Avess/Awais
UPDATE member_permissions mp
SET can_manage_tax_notices = true
FROM members m
WHERE mp.member_id = m.id
AND (
  m.email = 'k.saleem@unzegroup.com'
  OR m.email = 'khuram1901@gmail.com'
  OR m.name ILIKE '%shakeel%'
  OR m.name ILIKE '%awais%'
  OR m.name ILIKE '%avess%'
);
