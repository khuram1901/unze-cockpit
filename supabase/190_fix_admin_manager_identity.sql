-- Migration 190: Fix "Admin Manager" identity mix-up (v2)
--
-- Found 24/07/2026: the member record for khuram1901@gmail.com (Khuram's
-- admin login) was named "Admin Manager". Sunaina assigned 6 admin tasks
-- (theft cases, stock shortages, NTN registration) to it, believing it was
-- the actual admin manager — Muhammad Akhlaq. Because khuram1901@gmail.com
-- and k.saleem@unzegroup.com are linked as one identity in the app, those
-- tasks flooded Khuram's "Mine" view.
--
-- v2: first run hit a unique-constraint violation — one task already had
-- Akhlaq as co-assignee, so converting Khuram's row to Akhlaq made a
-- duplicate (task_assignees_task_id_member_email_key). Now we DELETE
-- Khuram's row where Akhlaq is already on the task, and convert the rest.
--
-- Apply manually via Supabase SQL Editor.

-- 1. Rename so it's unmistakably Khuram's admin account
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

-- 3a. Where Akhlaq is ALREADY a co-assignee on the task, just remove
--     Khuram's row (converting it would duplicate Akhlaq's).
DELETE FROM public.task_assignees ta
WHERE ta.member_email = 'khuram1901@gmail.com'
  AND EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = ta.task_id
      AND t.status NOT IN ('Completed', 'Cancelled')
  )
  AND EXISTS (
    SELECT 1 FROM public.task_assignees x
    WHERE x.task_id = ta.task_id
      AND x.member_email = 'akhlaq@unze.co.uk'
  );

-- 3b. Convert the remaining Khuram rows to Akhlaq
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
