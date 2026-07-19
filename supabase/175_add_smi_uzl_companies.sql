-- 175 — Add S&M Investments and Unze London as companies
-- Apply in Supabase SQL Editor.
--
-- Uses fixed UUIDs so constants.ts can reference the same values
-- without a second round-trip to look them up after applying.
--
-- S&M Investments  → 7f3b9e2a-4c1d-4f8e-a234-b5c6d7e8f901
-- Unze London      → 8a4c0f3b-5d2e-4a9f-b345-c6d7e8f90012

-- 1. Add the two companies
INSERT INTO companies (id, name, short_code) VALUES
  ('7f3b9e2a-4c1d-4f8e-a234-b5c6d7e8f901', 'S&M Investments', 'SMI'),
  ('8a4c0f3b-5d2e-4a9f-b345-c6d7e8f90012', 'Unze London',     'UZL')
ON CONFLICT (id) DO NOTHING;

-- 2. Link S&M Investments Folderit account → new company
INSERT INTO folderit_account_companies (account_uid, company_uuid)
VALUES ('JsXvG0hu5g', '7f3b9e2a-4c1d-4f8e-a234-b5c6d7e8f901')
ON CONFLICT DO NOTHING;

-- 3. Unze London Folderit account (6cVIn0up6S) was previously mapped to
--    IFPL's UUID as a placeholder. Update it to the proper company.
UPDATE folderit_account_companies
SET company_uuid = '8a4c0f3b-5d2e-4a9f-b345-c6d7e8f90012'
WHERE account_uid = '6cVIn0up6S'
  AND company_uuid = '77921705-8a15-4406-847a-b234f84b5ec3';

-- 4. Activate S&M Investments in the sync — was scope 'pending', now live
UPDATE folderit_account_map
SET scope = 'company'
WHERE account_uid = 'JsXvG0hu5g';

-- Verify
SELECT am.account_name, am.scope, ac.company_uuid, c.name AS company_name
FROM folderit_account_map am
LEFT JOIN folderit_account_companies ac ON ac.account_uid = am.account_uid
LEFT JOIN companies c ON c.id = ac.company_uuid
ORDER BY am.account_name;
