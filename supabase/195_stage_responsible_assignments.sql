-- Migration 195: Assign responsible persons to audit stages per Shahid's table
--
-- Stage assignments (all companies):
--   1  Audit Planning                         → Shahid
--   2  Data Collection                        → Junaid Athar
--   3  Data Verification                      → Amina (UTPL) / Junaid Sheikh (IFPL) / Khizar (HD, BRNH)
--   4  Composition of audit findings          → Amina (UTPL) / Junaid Sheikh (IFPL) / Khizar (HD, BRNH)
--   5  Draft Internal audit report            → Junaid Athar
--   6  Review audit report                    → Shahid
--   7  Communication of audit report          → Shahid
--   8  Submission to senior management        → Shahid
--
-- This replaces all existing responsible/responsible_2 values across all 63 processes.

update audit_stage_tasks t
set
  responsible = case
    when t.stage_no in (1, 6, 7, 8) then 'Shahid'
    when t.stage_no in (2, 5)       then 'Junaid Athar'
    when t.stage_no in (3, 4) then
      case c.short_code
        when 'UTPL' then 'Amina'
        when 'IFPL' then 'Junaid Sheikh'
        else 'Khizar'   -- HD and BRNH both → Hospitality post-audit team
      end
    else t.responsible   -- safety: leave any unexpected stage untouched
  end,
  responsible_2 = null
from audit_plan_processes p
join companies c on c.id = p.company_id
where t.process_id = p.id;
