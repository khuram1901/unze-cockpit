-- Migration 220c: Department name cleanup
-- Applied inline via MCP in session 2026-10-14; this file documents those changes for audit trail.
-- All statements below are idempotent (safe to re-run against the live DB).

-- 1. Rename "Accounts UTPL" → "Accounts Unze Trading"
--    (consistent with Accounts IFPL / Accounts Baranh / Accounts UK naming pattern)
--    Applied inline: 2026-10-14
UPDATE public.departments
SET department_name = 'Accounts Unze Trading'
WHERE department_name = 'Accounts UTPL';

-- 2. Deactivate "Unze Trading Accounts" (legacy duplicate; no members assigned)
--    Applied inline: 2026-10-14
UPDATE public.departments
SET active = false
WHERE department_name = 'Unze Trading Accounts';

-- 3. Deactivate "Unze Metering" (legacy name; renamed to "Unze Meter Operations" in migration 220)
--    Applied inline: 2026-10-14
UPDATE public.departments
SET active = false
WHERE department_name = 'Unze Metering';
