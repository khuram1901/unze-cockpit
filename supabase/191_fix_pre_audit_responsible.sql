-- Migration 191: Correct pre-audit responsible assignments
--
-- Abdul Rehman was incorrectly assigned to HD + BRNH (Final settlement audit).
-- Attia was incorrectly assigned to IFPL (Final settlement audit).
--
-- Correct assignments:
--   Abdul Rehman → IFPL  (Final settlement audit, stages 3 & 4)
--   Attia        → HD + BRNH (Final settlement audit, stages 3 & 4)
--   Fraz         → UTPL (unchanged)
--
-- Swap done via temp placeholder to avoid overwriting mid-update.

-- Step 1: park Abdul Rehman's HD+BRNH tasks under a temp name
update audit_stage_tasks
set responsible = '_swap_ar'
where responsible = 'Abdul Rehman'
  and process_id in (
    select p.id from audit_plan_processes p
    join companies c on c.id = p.company_id
    where c.short_code in ('HD', 'BRNH')
  );

-- Step 2: move Attia's IFPL tasks to Abdul Rehman
update audit_stage_tasks
set responsible = 'Abdul Rehman'
where responsible = 'Attia'
  and process_id in (
    select p.id from audit_plan_processes p
    join companies c on c.id = p.company_id
    where c.short_code = 'IFPL'
  );

-- Step 3: move parked tasks to Attia (HD + BRNH)
update audit_stage_tasks
set responsible = 'Attia'
where responsible = '_swap_ar';
