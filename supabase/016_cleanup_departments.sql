-- Merge "Unze Trading Accounts" into "Finance"
-- The company field distinguishes which company's finance team they belong to.
-- Run this in Supabase SQL Editor.

UPDATE members
SET department = 'Finance'
WHERE department = 'Unze Trading Accounts';

-- Also fix any members with short company names
UPDATE members
SET company = 'Unze Trading PVT Limited'
WHERE company = 'Unze Trading' AND company != 'Unze Trading PVT Limited';

UPDATE members
SET company = 'Imperial Footwear PVT Limited'
WHERE company = 'Imperial Footwear' AND company != 'Imperial Footwear PVT Limited';

-- Verify
SELECT email, name, role, department, company
FROM members
WHERE department = 'Finance'
ORDER BY company, name;
