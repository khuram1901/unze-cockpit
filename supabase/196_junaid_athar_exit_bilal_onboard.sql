-- Migration 196: Junaid Athar departure + Bilal Maqbool Bhatti onboarding
--
-- 1. Deactivate Junaid Athar (member + auth ban)
-- 2. Reassign his stages (2 & 5) to post-audit member per company
-- 3. Add Bilal Maqbool Bhatti as Field Auditor (Hospitality / BRNH)

-- ── 1a. Deactivate Junaid Athar in members ────────────────────────────────────
update members set is_active = false where lower(email) = 'junaid.athar@unze.co.uk';

-- ── 1b. Ban his auth account (prevents login without deleting audit trail) ────
update auth.users
set banned_until = '2099-12-31 00:00:00+00'
where email = 'junaid.athar@unze.co.uk';

-- ── 2. Reassign stages 2 & 5 (was Junaid Athar) to post-audit member ─────────
-- New assignments (same pattern as stages 3 & 4):
--   UTPL        → Amina
--   IFPL        → Junaid Sheikh
--   HD / BRNH   → Khizar
update audit_stage_tasks t
set responsible = case c.short_code
  when 'UTPL' then 'Amina'
  when 'IFPL' then 'Junaid Sheikh'
  else 'Khizar'   -- HD and BRNH
end
from audit_plan_processes p
join companies c on c.id = p.company_id
where t.process_id = p.id
  and t.stage_no in (2, 5);

-- ── 3. Add Bilal Maqbool Bhatti ───────────────────────────────────────────────
insert into members (
  name, first_name, last_name, email,
  role, department, position_title,
  company_id, company,
  is_active, notify_email
)
values (
  'Bilal Maqbool Bhatti', 'Bilal', 'Maqbool Bhatti',
  'bilal.maqbool@baranh.pk',
  'Member',
  'Audit',
  'Field Auditor',
  '6401ba75-f297-4617-84c1-305bcaf35a50',  -- BRNH
  'BRNH',
  true,
  true
)
on conflict (email) do update
  set is_active = true,
      name = excluded.name,
      position_title = excluded.position_title;
