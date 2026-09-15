-- 245_scoped_ea_permissions.sql
-- Adds per-member task/minutes scoping for executive assistants who
-- report to a specific person (e.g. Rimsha & Ali → Kamran).
-- When scoped_to_member_id is set, the app shows the EA their own
-- tasks/minutes PLUS the scoped member's tasks/minutes only.

-- 1. Add scoping column
ALTER TABLE member_permissions
ADD COLUMN IF NOT EXISTS scoped_to_member_id UUID REFERENCES members(id);

-- 2. Fix Sundas — remove investment edit rights (she had edit but not view,
--    which was inconsistent; now no one below Admin/CEO touches investments)
UPDATE member_permissions
SET can_edit_investments        = false,
    can_refresh_investment_prices = false
WHERE member_id = '36410e54-b690-456a-b053-898de24ac39a'; -- Hafiza Sundas

-- 3. Update Rimsha profile (employee 1128)
UPDATE members
SET company        = 'Unze Group',
    company_id     = 'e867582b-2093-4d10-8eaf-de54a168ee55',
    business_unit  = 'Head Office',
    department     = NULL,
    position_title = 'Executive Assistant',
    role           = 'Executive'
WHERE employee_code = '1128';

-- 4. Update Ali Ramzan profile (employee 575)
UPDATE members
SET company        = 'Unze Group',
    company_id     = 'e867582b-2093-4d10-8eaf-de54a168ee55',
    business_unit  = 'Head Office',
    department     = NULL,
    position_title = 'Executive Assistant',
    role           = 'Executive'
WHERE employee_code = '575';

-- 5. Insert permissions for Rimsha — scoped to Kamran (d845d6e5-...)
INSERT INTO member_permissions (
  member_id,                scoped_to_member_id,
  can_view_pa_dashboard,    can_see_all_tasks,      can_review_tasks,
  can_manage_recurring_tasks, can_see_all_minutes,  can_manage_meetings,
  can_view_members,         can_add_members,        can_edit_members,
  can_delete_members,       can_reset_passwords,    can_import_export,
  can_view_audit_log,       can_view_exceptions,
  can_view_finance,         can_edit_finance,       can_view_receivables,
  can_view_investments,     can_edit_investments,   can_refresh_investment_prices,
  can_view_folderit_hr,
  folderit_can_view_utpl,   folderit_can_view_ifpl, folderit_can_view_rst,
  folderit_can_view_smi,    folderit_can_view_uzl,  folderit_can_view_dir
) VALUES (
  '7836982b-497d-46ff-ad54-0849aa917d98',  -- Rimsha
  'd845d6e5-bf60-4b2e-8e9e-faac1a4d7b01',  -- Kamran
  true,  true,  true,
  false, true,  true,
  true,  false, false,
  false, false, false,
  false, false,
  false, false, false,
  false, false, false,
  false,
  false, false, false,
  false, false, false
);

-- 6. Insert permissions for Ali Ramzan — scoped to Kamran
INSERT INTO member_permissions (
  member_id,                scoped_to_member_id,
  can_view_pa_dashboard,    can_see_all_tasks,      can_review_tasks,
  can_manage_recurring_tasks, can_see_all_minutes,  can_manage_meetings,
  can_view_members,         can_add_members,        can_edit_members,
  can_delete_members,       can_reset_passwords,    can_import_export,
  can_view_audit_log,       can_view_exceptions,
  can_view_finance,         can_edit_finance,       can_view_receivables,
  can_view_investments,     can_edit_investments,   can_refresh_investment_prices,
  can_view_folderit_hr,
  folderit_can_view_utpl,   folderit_can_view_ifpl, folderit_can_view_rst,
  folderit_can_view_smi,    folderit_can_view_uzl,  folderit_can_view_dir
) VALUES (
  '7a0f1ab4-615c-4075-96fc-32c11c2df25c',  -- Ali Ramzan
  'd845d6e5-bf60-4b2e-8e9e-faac1a4d7b01',  -- Kamran
  true,  true,  true,
  false, true,  true,
  true,  false, false,
  false, false, false,
  false, false,
  false, false, false,
  false, false, false,
  false,
  false, false, false,
  false, false, false
);
