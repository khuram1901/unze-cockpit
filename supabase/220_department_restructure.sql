-- Migration 220: Department restructure
-- Approved by Khuram Saleem, 14/10/2026
--
-- Changes:
--   1. Marketing → reassign from Unze Group to IFPL
--   2. Restaurant members → move to Restaurant Head Office (Restaurant deactivated)
--   3. Retail Operations → merge into Retail Head Office (members + tasks), deactivate
--   4. Unze Trading → deactivate, add new "Unze Trading Accounts" (UTPL)
--   5. Unze Metering → rename to "Unze Meter Operations"
--
-- Apply manually via Supabase SQL Editor.

BEGIN;

-- ─── 1. Marketing: move company from Unze Group → IFPL ─────────────────────
UPDATE public.departments
SET default_company_id = '77921705-8a15-4406-847a-b234f84b5ec3'  -- IFPL
WHERE department_name = 'Marketing';

-- ─── 2. Restaurant: move named members → Restaurant Head Office ─────────────
-- Zulfiqar Ahmad: confirm with Khuram before applying
-- (remove the WHERE IN filter below and use department = 'Restaurant' to move ALL three)
UPDATE public.members
SET department = 'Restaurant Head Office'
WHERE department = 'Restaurant'
  AND name IN ('Shahzaib Khan', 'Zeeshan  Iqbal');
-- Note: Zulfiqar Ahmad is the 3rd member — awaiting decision

-- Deactivate Restaurant (no tasks, will have ≤1 member after above)
-- UNCOMMENT the line below once ALL Restaurant members are moved out:
-- UPDATE public.departments SET active = false WHERE department_name = 'Restaurant';

-- ─── 3. Retail Operations → Retail Head Office ─────────────────────────────
-- 3a. Move all 7 members
UPDATE public.members
SET department = 'Retail Head Office'
WHERE department = 'Retail Operations';

-- 3b. Move all 26 tasks
UPDATE public.tasks
SET assigned_to_department = 'Retail Head Office'
WHERE assigned_to_department = 'Retail Operations';

-- 3c. Deactivate Retail Operations
UPDATE public.departments
SET active = false
WHERE department_name = 'Retail Operations';

-- ─── 4. Unze Trading → deactivate + add Unze Trading Accounts ──────────────
-- Deactivate Unze Trading (0 members, 0 tasks — safe)
UPDATE public.departments
SET active = false
WHERE department_name = 'Unze Trading';

-- Add new Unze Trading Accounts under UTPL
INSERT INTO public.departments (department_name, active, default_company_id, source)
SELECT 'Unze Trading Accounts', true, '15884c2d-48a4-4d43-be90-0ef6e130790c', 'manual'
WHERE NOT EXISTS (
  SELECT 1 FROM public.departments WHERE department_name = 'Unze Trading Accounts'
);

-- ─── 5. Unze Metering → rename to Unze Meter Operations ────────────────────
UPDATE public.departments
SET department_name = 'Unze Meter Operations'
WHERE department_name = 'Unze Metering';

COMMIT;
