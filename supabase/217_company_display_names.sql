-- 217: Standardise company display names (Khuram 30/08/2026)
-- Applied via Supabase MCP same day. Friendly names used everywhere:
-- Unze Group, Imperial Footwear, Unze Trading, Baranh, HD, Unze London,
-- S&M Investment, K&K Jhang, Almehr (was Almahar), Directors (unchanged).
-- HR RPCs updated to return companies.name instead of short_code.
-- Full SQL as applied — see migration company_display_names in Supabase.
update companies set name = 'Imperial Footwear' where short_code = 'IFPL';
update companies set name = 'Unze Trading'      where short_code = 'UTPL';
update companies set name = 'HD'                 where short_code = 'HD';
update companies set name = 'S&M Investment'     where short_code = 'SMI';
update companies set name = 'Almehr'             where short_code = 'ALM';
