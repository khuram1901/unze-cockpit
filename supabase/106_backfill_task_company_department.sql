-- 106_backfill_task_company_department.sql
--
-- Data backfill for the 77 tasks that existed before the Tasks redesign
-- (company_id + department were added as new required fields — migration
-- 098 — but existing rows were never populated).
--
-- Per Khuram: any task missing a Company should default to Unze Trading
-- (UTPL), and any task missing a Department should default to whatever is
-- obvious — in this case, all 11 rows with a missing department belong to
-- Sundas Hussain (PA) and match her other recurring-generated tasks, which
-- are all tagged "Executive Office".
--
-- NOTE: priority and owner were NOT touched. A direct query on the live
-- database (13/07/2026) showed 0 of 77 tasks are missing priority (38
-- High / 19 Medium / 11 Normal / 8 Urgent / 1 Low — all real, varied
-- values) and 0 are missing an owner or owner email. Overwriting these
-- would destroy real data, so this migration only fills in the two
-- fields that are genuinely blank.

-- 1. Company: 77 rows currently have company_id IS NULL -> tag as UTPL
update public.tasks
set company_id = '15884c2d-48a4-4d43-be90-0ef6e130790c' -- Unze Trading Pvt Ltd (UTPL)
where company_id is null;

-- 2. Department: 11 rows currently have no department set, all belong to
--    Sundas Hussain (pa.ceo@unze.co.uk) and match her other tasks -> Executive Office
update public.tasks
set assigned_to_department = 'Executive Office'
where (assigned_to_department is null or assigned_to_department = '')
  and assigned_to_email = 'pa.ceo@unze.co.uk';

-- 3. Safety net: anything still missing a department after step 2 (should
--    be 0 rows, but in case new data appeared between the audit and this
--    running) -> Unassigned, per Khuram's fallback rule, rather than
--    silently left blank.
update public.tasks
set assigned_to_department = 'Unassigned'
where assigned_to_department is null or assigned_to_department = '';
