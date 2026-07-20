-- Migration 183: Add task_default_company_id to members
--
-- These people work across the whole Unze Group and shouldn't have their
-- member profile tied to one company. But when creating a task for them,
-- we need a sensible default so the form auto-fills without asking.
--
-- task_default_company_id is ONLY used by the Quick Add / Voice task form.
-- It does not affect the member profile, HR records, or any other page.
--
-- Defaults applied:
--   Muhammad Shakeel, Muhammad Akhlaq, Zuhair Khalid, Kamran Saleem → IFPL
--   Plant workers (MEPCO / FESCO / PESCO)                           → UTPL
--   Unze Trading Ops department                                      → UTPL
--   All other Head Office shared-services staff                      → UTPL
--   CEO Khuram Saleem                                                → DIR
--   Executive / PA (Sundas)                                          → DIR
--
-- Apply via: Supabase Dashboard → SQL Editor → run this file.
-- After applying, you can override any individual via:
--   UPDATE members SET task_default_company_id = '<company uuid>'
--   WHERE name = '...';

alter table members
  add column if not exists task_default_company_id uuid references companies(id);

-- 1. IFPL override — group-wide staff who default to Imperial for task purposes
update members
set    task_default_company_id = (select id from companies where short_code = 'IFPL')
where  name in ('Muhammad Shakeel', 'Muhammad Akhlaq', 'Zuhair Khalid', 'Kamran Saleem');

-- 2. Plant workers → UTPL
update members
set    task_default_company_id = (select id from companies where short_code = 'UTPL')
where  business_unit in ('MEPCO Plant', 'FESCO Plant', 'PESCO Plant', 'FIEDMC Plant')
  and  task_default_company_id is null;

-- 3. Unze Trading Ops department → UTPL
update members
set    task_default_company_id = (select id from companies where short_code = 'UTPL')
where  department = 'Unze Trading Ops'
  and  task_default_company_id is null;

-- 4. Head Office shared-services → UTPL (Finance, Audit, Tax, Admin, HR, IT)
update members
set    task_default_company_id = (select id from companies where short_code = 'UTPL')
where  business_unit = 'Head Office'
  and  task_default_company_id is null;

-- 5. Executive / PA roles → Directors
update members
set    task_default_company_id = (select id from companies where short_code = 'DIR')
where  role = 'Executive'
  and  task_default_company_id is null;

-- 6. CEO → Directors
update members
set    task_default_company_id = (select id from companies where short_code = 'DIR')
where  role = 'CEO'
  and  task_default_company_id is null;

-- Verify — should show a company for every active member
select m.name, m.role, m.department, c.name as task_company
from   members m
left   join companies c on c.id = m.task_default_company_id
where  m.is_active = true
order  by m.name;
