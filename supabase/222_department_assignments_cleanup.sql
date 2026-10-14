-- Migration 222: Department assignments cleanup
-- Applied: 2026-10-14
--
-- 1. Move 33 store login accounts → Retail Store
-- 2. Move Asad Maqsood → Executive Office
-- 3. Move 3 Accounts members → Accounts IFPL (Imperial Footwear)

-- 1. Store logins (all have name = 'Store login: /daily-sales only', null department)
UPDATE public.members
SET department = 'Retail Store'
WHERE name = 'Store login: /daily-sales only'
  AND (department IS NULL OR department = '');

-- 2. Asad Maqsood → Executive Office
UPDATE public.members
SET department = 'Executive Office'
WHERE email = 'asad.maqsood@unze.co.uk';

-- 3. Remaining Accounts members → Accounts IFPL
UPDATE public.members
SET department = 'Accounts IFPL'
WHERE department = 'Accounts'
  AND email IN (
    'accounts.payable2@unze.co.uk',
    'shahida.naseem@unze.co.uk',
    'zeeshan.ashraf@unze.co.uk'
  );
