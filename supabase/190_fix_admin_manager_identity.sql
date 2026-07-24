-- Migration 190: Fix "Admin Manager" identity mix-up
--
-- Found 24/07/2026: the member record for khuram1901@gmail.com (Khuram's
-- admin login) was named "Admin Manager". Sunaina assigned 6 admin tasks
-- (theft cases, stock shortages, NTN registration) to it, believing it was
-- the actual admin manager — Muhammad Akhlaq. Because khuram1901@gmail.com
-- and k.saleem@unzegroup.com are linked as one identity in the app, those
-- tasks flooded Khuram's "Mine" view.
--
-- 1. Rename the record so it's unmistakably Khuram's admin account.
-- 2. Move the 6 open mis-assigned tasks to Muhammad Akhlaq.
-- 3. Fix the matching task_assignees rows.
--
-- Apply manually via Supabase SQL Editor.

-- 1. Rename
UPDATE public.members
SET name = 'Khuram Saleem (Admin)'
WHERE email = 'khuram1901@gmail.com';

-- 2. Reassign open tasks to Muhammad Akhlaq
UPDATE public.tasks
SET assigned_to = 'Muhammad Akhlaq',
    assigned_to_email = 'akhlaq@unze.co.uk',
    assigned_to_department = 'Admin',
    assigned_to_business_unit = 'Head Office',
    updated_at = now()
WHERE assigned_to_email = 'khuram1901@gmail.com'
  AND status NOT IN ('Completed', 'Cancelled');

-- 3. Fix co-assignee rows for those tasks
UPDATE public.task_assignees ta
SET member_id = (SELECT id FROM public.members WHERE email = 'akhlaq@unze.co.uk'),
    member_name = 'Muhammad Akhlaq',
    member_email = 'akhlaq@unze.co.uk'
WHERE ta.member_email = 'khuram1901@gmail.com'
  AND EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = ta.task_id
      AND t.status NOT IN ('Completed', 'Cancelled')
  );

-- Verify:
-- SELECT assigned_to, assigned_to_email, description, status FROM tasks
-- WHERE assigned_to_email IN ('akhlaq@unze.co.uk','khuram1901@gmail.com')
-- AND status NOT IN ('Completed','Cancelled');
