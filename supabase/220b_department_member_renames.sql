-- Migration 220b: Companion to 220 — rename stale department values on members
-- + add Accounts UTPL and Accounts IFPL departments
-- Approved by Khuram Saleem, 14/10/2026
--
-- Context:
--   Members were stored with fallback department names ("Unze Trading Ops",
--   "Audit") that no longer match the canonical DB names. This migration
--   renames them so code permission checks and DB canonical names stay in sync.
--
-- Apply AFTER migration 220. Apply manually via Supabase SQL Editor.

BEGIN;

-- ─── 1. Rename 8 members: Unze Trading Ops → Unze Trading Operations ────────
UPDATE public.members
SET department = 'Unze Trading Operations'
WHERE department = 'Unze Trading Ops';

-- ─── 2. Rename 9 members: Audit → Internal Audit ────────────────────────────
UPDATE public.members
SET department = 'Internal Audit'
WHERE department = 'Audit';

-- ─── 3. Rename tasks: Unze Trading Ops → Unze Trading Operations ─────────────
UPDATE public.tasks
SET assigned_to_department = 'Unze Trading Operations'
WHERE assigned_to_department = 'Unze Trading Ops';

-- ─── 4. Rename tasks: Audit → Internal Audit ─────────────────────────────────
UPDATE public.tasks
SET assigned_to_department = 'Internal Audit'
WHERE assigned_to_department = 'Audit';

-- ─── 5. Add Accounts UTPL (under UTPL) ───────────────────────────────────────
INSERT INTO public.departments (department_name, active, default_company_id, source)
SELECT 'Accounts UTPL', true, '15884c2d-48a4-4d43-be90-0ef6e130790c', 'manual'
WHERE NOT EXISTS (
  SELECT 1 FROM public.departments WHERE department_name = 'Accounts UTPL'
);

-- ─── 6. Add Accounts IFPL (under IFPL) ───────────────────────────────────────
INSERT INTO public.departments (department_name, active, default_company_id, source)
SELECT 'Accounts IFPL', true, '77921705-8a15-4406-847a-b234f84b5ec3', 'manual'
WHERE NOT EXISTS (
  SELECT 1 FROM public.departments WHERE department_name = 'Accounts IFPL'
);

-- Verify — run this after applying to confirm zero rows remain with old names:
-- SELECT department, count(*) FROM public.members
-- WHERE department IN ('Unze Trading Ops', 'Audit')
-- GROUP BY department;

COMMIT;
