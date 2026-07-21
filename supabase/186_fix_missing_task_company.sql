-- Migration 186: Set up both Executive Office PAs (Sultan + Sundas)
--              and fix remaining members with no task_default_company_id
--
-- Muhammad Sultan is being moved from Admin/Member to Executive Office/Executive,
-- matching Sundas Hussain. Both PAs work for the CEO, sit in the Directors
-- entity for task purposes, and are in the Executive Office department.
--
-- Apply via: Supabase Dashboard → SQL Editor → run this file.

-- ── 1. Muhammad Sultan — promote to Executive Office PA ───────────────────
UPDATE members
SET
  role                    = 'Executive',
  department              = 'Executive Office',
  business_unit           = NULL,
  company                 = 'Unze Group',
  task_default_company_id = (SELECT id FROM companies WHERE short_code = 'DIR')
WHERE name = 'Muhammad  Sultan';

-- ── 2. Sundas Hussain — same department, already correct role/company ─────
UPDATE members
SET
  department = 'Executive Office'
WHERE name = 'Sundas Hussain';

-- ── 3. Fix Admin Manager (no business_unit → default UTPL) ───────────────
UPDATE members
SET task_default_company_id = (SELECT id FROM companies WHERE short_code = 'UTPL')
WHERE name = 'Admin Manager'
  AND task_default_company_id IS NULL;

-- ── 4. Safety net — catch any Head Office members added after migration 183
UPDATE members
SET task_default_company_id = (SELECT id FROM companies WHERE short_code = 'UTPL')
WHERE business_unit = 'Head Office'
  AND task_default_company_id IS NULL;

-- ── Verify — Sultan and Sundas should look identical in structure ─────────
SELECT name, role, department, company, c.short_code AS task_company
FROM   members m
LEFT   JOIN companies c ON c.id = m.task_default_company_id
WHERE  m.name IN ('Muhammad  Sultan', 'Sundas Hussain');
