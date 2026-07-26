-- Migration 196: Add can_access_banking column and grant to Khuram + Kamran
-- Apply manually via Supabase SQL Editor.

-- 1. Add the column (safe — does nothing if it already exists)
ALTER TABLE member_permissions
  ADD COLUMN IF NOT EXISTS can_access_banking BOOLEAN DEFAULT NULL;

-- 2. Grant access to Khuram (khuram1901@gmail.com)
UPDATE member_permissions mp
SET can_access_banking = true
FROM members m
WHERE mp.member_id = m.id
  AND lower(m.email) = 'khuram1901@gmail.com';

-- 3. Grant access to Khuram's work account (k.saleem@unzegroup.com)
UPDATE member_permissions mp
SET can_access_banking = true
FROM members m
WHERE mp.member_id = m.id
  AND lower(m.email) = 'k.saleem@unzegroup.com';

-- 4. Grant access to Kamran Saleem
UPDATE member_permissions mp
SET can_access_banking = true
FROM members m
WHERE mp.member_id = m.id
  AND lower(m.email) = 'kamran.saleem@unzegroup.com';

-- Verify
SELECT m.email, mp.can_access_banking
FROM member_permissions mp
JOIN members m ON m.id = mp.member_id
WHERE mp.can_access_banking = true
ORDER BY m.email;
