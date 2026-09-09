-- 224: Role-based access audit (09/09/2026) — tighten FlowHCM RLS
-- All UI reads of flw_* tables go through API routes (service client),
-- so direct browser-read policies served no purpose and leaked
-- financial data: advances/PF/allowances/deductions/tax were readable
-- by ANY logged-in user, and salary_setup by the PA via is_privileged()
-- (breaching rule 6). All flw_* tables now match flw_employees: RLS on,
-- no client policies — service-role/API access only.
-- Companion code changes in the same commit:
--   /api/flowhcm/data       financial modules → Admin/CEO + HR/Fin Managers;
--                           workforce modules → management + HR department
--   /api/finance/receivables-search → Admin/CEO + Finance/Ops Managers
--   /api/hr/performance/*   → management + HR department (shared
--                           getMemberAccess() helper in app/lib/api-auth.ts)
drop policy if exists authenticated_read_flw_advance_salary on flw_advance_salary;
drop policy if exists authenticated_read_flw_allowances on flw_allowances;
drop policy if exists authenticated_read_flw_deductions on flw_deductions;
drop policy if exists authenticated_read_flw_overtime on flw_overtime;
drop policy if exists authenticated_read_flw_pf_data on flw_pf_data;
drop policy if exists authenticated_read_flw_tax_adjustments on flw_tax_adjustments;
drop policy if exists flw_salary_setup_read on flw_salary_setup;
drop policy if exists authenticated_read_flw_transfers on flw_transfers;
drop policy if exists authenticated_read_flw_exemptions on flw_exemptions;
drop policy if exists authenticated_read_flw_employee_exits on flw_employee_exits;
