-- Migration 193: Move the two department-less tasks off the CEOs' plates
--
-- Khuram (24/07/2026): "no one is assigning task to me or Kamran as we
-- are the ceo... hiring is the task for HR, and PAK is for sundus."
--
-- 1. The hiring task (assigned to Kamran) goes to Zuhair Khalid, HR
--    manager. Status back to In Progress (it was Submitted, i.e. parked
--    on Kamran's sign-off queue — it's HR's work now, not his).
-- 2. Pak Qatar - Payment inquiry stays with Sundas Hussain; it just
--    gets her department (Executive Office) so it leaves "Unassigned".
--
-- The CEO assignment lock (same date, in code) prevents this happening
-- again: only the CEO accounts and the PA can assign tasks to a CEO.
--
-- Apply manually via Supabase SQL Editor.

begin;

-- 1. Hiring task → Zuhair Khalid (HR)
UPDATE public.tasks
SET assigned_to = 'Zuhair Khalid',
    assigned_to_email = 'zuhair.syed@unze.co.uk',
    assigned_to_department = 'HR',
    assigned_to_business_unit = (SELECT business_unit FROM public.members WHERE email = 'zuhair.syed@unze.co.uk'),
    status = 'In Progress',
    submitted_by_name = NULL,
    submitted_by_email = NULL,
    updated_at = now()
WHERE assigned_to_email = 'kamran@unze.co.uk'
  AND description ILIKE 'Immediate hiring%'
  AND status NOT IN ('Completed', 'Cancelled');

-- Keep task_assignees in step (delete Kamran's row if Zuhair already
-- co-assigned; otherwise convert it)
DELETE FROM public.task_assignees ta
USING public.tasks t
WHERE ta.task_id = t.id
  AND ta.member_email = 'kamran@unze.co.uk'
  AND t.description ILIKE 'Immediate hiring%'
  AND EXISTS (
    SELECT 1 FROM public.task_assignees x
    WHERE x.task_id = ta.task_id AND x.member_email = 'zuhair.syed@unze.co.uk'
  );

UPDATE public.task_assignees ta
SET member_id = (SELECT id FROM public.members WHERE email = 'zuhair.syed@unze.co.uk'),
    member_name = 'Zuhair Khalid',
    member_email = 'zuhair.syed@unze.co.uk'
FROM public.tasks t
WHERE ta.task_id = t.id
  AND ta.member_email = 'kamran@unze.co.uk'
  AND t.description ILIKE 'Immediate hiring%';

-- 2. Pak Qatar → tag with Sundas's department
UPDATE public.tasks
SET assigned_to_department = 'Executive Office',
    updated_at = now()
WHERE description ILIKE 'Pak Qatar%'
  AND assigned_to_department IS NULL
  AND status NOT IN ('Completed', 'Cancelled');

commit;

-- Verify:
-- SELECT description, assigned_to, assigned_to_department, status FROM tasks
-- WHERE description ILIKE 'Immediate hiring%' OR description ILIKE 'Pak Qatar%';
