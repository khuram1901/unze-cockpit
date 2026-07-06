-- 069_normalise_imperial_footwear.sql
-- Normalises the Imperial Footwear company name across all legal notices.
-- Two stale variants ('Imperial Footwear PVT Limited', 'Imperial Footwear')
-- are merged into the canonical value used by the majority of notices.
--
-- Apply manually in Supabase SQL Editor.

UPDATE legal_notices
SET company_name = 'Imperial Footwear Pvt Limited'
WHERE company_name IN ('Imperial Footwear PVT Limited', 'Imperial Footwear');

-- Verify — should show exactly one Imperial Footwear row with count=5:
SELECT company_name, COUNT(*) AS notice_count
FROM legal_notices
GROUP BY company_name
ORDER BY company_name;
