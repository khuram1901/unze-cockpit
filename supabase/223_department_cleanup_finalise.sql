-- Migration 223: Finalise department cleanup
-- Applied: 2026-10-14
--
-- 1. Add Executive Office as an active department (4 members + 102 tasks already use it)
-- 2. Fix "CCTV" → "CCTV and Surveillance" on member + tasks
-- 3. Fix "Fit Out & Maintenance" → "Fit Out and Maintenance" on member + tasks
-- 4. Move 24 orphaned Accounts tasks → Accounts IFPL
-- 5. DELETE the now-empty, deactivated Accounts department row

-- 1. Add Executive Office department
INSERT INTO public.departments (department_name, active, default_company_id, source)
VALUES ('Executive Office', true, 'e867582b-2093-4d10-8eaf-de54a168ee55', 'manual')
ON CONFLICT (department_name) DO UPDATE SET active = true;

-- 2a. Fix CCTV member
UPDATE public.members
SET department = 'CCTV and Surveillance'
WHERE department = 'CCTV';

-- 2b. Fix CCTV tasks
UPDATE public.tasks
SET assigned_to_department = 'CCTV and Surveillance'
WHERE assigned_to_department = 'CCTV';

-- 3a. Fix Fit Out & Maintenance member (ampersand → and)
UPDATE public.members
SET department = 'Fit Out and Maintenance'
WHERE department = 'Fit Out & Maintenance';

-- 3b. Fix Fit Out & Maintenance tasks
UPDATE public.tasks
SET assigned_to_department = 'Fit Out and Maintenance'
WHERE assigned_to_department = 'Fit Out & Maintenance';

-- 4. Move orphaned Accounts tasks to Accounts IFPL
UPDATE public.tasks
SET assigned_to_department = 'Accounts IFPL'
WHERE assigned_to_department = 'Accounts';

-- 5. Delete the Accounts department row entirely
DELETE FROM public.departments
WHERE department_name = 'Accounts';
