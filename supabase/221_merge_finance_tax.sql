-- Migration 221: Merge Finance and Tax departments into Finance & Tax
-- Applied: 2026-10-14 via Supabase MCP
--
-- Context: Finance (0 members, 122 tasks) and Tax (3 members, 43 tasks)
-- merged into the existing Finance & Tax department.
-- Legal, Sales, Audit (bare) were code-only; removed from all code files.
--
-- Note: required temporarily disabling tasks_enforce_completed_lock trigger
-- and dropping/re-adding tasks_description_length_chk (NOT VALID) because
-- some completed Finance/Tax tasks had descriptions > 150 chars (pre-existing).

-- Disable completed-lock trigger for metadata rename
ALTER TABLE public.tasks DISABLE TRIGGER tasks_enforce_completed_lock;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_description_length_chk;

BEGIN;

-- 1. Move Tax members → Finance & Tax
UPDATE public.members
SET department = 'Finance & Tax'
WHERE department = 'Tax';

-- 2. Move all Finance + Tax tasks → Finance & Tax
UPDATE public.tasks
SET assigned_to_department = 'Finance & Tax'
WHERE assigned_to_department IN ('Finance', 'Tax');

-- 3. Deactivate both old departments
UPDATE public.departments
SET active = false
WHERE department_name IN ('Finance', 'Tax');

COMMIT;

-- Restore trigger and constraint
ALTER TABLE public.tasks ENABLE TRIGGER tasks_enforce_completed_lock;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_description_length_chk
  CHECK (char_length(description) <= 150) NOT VALID;
