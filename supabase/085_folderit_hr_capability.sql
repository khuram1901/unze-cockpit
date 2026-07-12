-- ============================================================
-- 085: HR document viewing becomes a real, grantable capability
--
-- Khuram: "give me access for HR to view the documents. Nobody else
-- should have access. Then build this feature into the members access
-- matrix, and call it Folderit. In there, create the box 'HR'. If I want
-- to give any member access to HR, only they should get access to HR,
-- which enables them to see the documents like we have done for CEO."
--
-- Adds one boolean override column, same pattern as every other
-- capability in member_permissions. NULL = use the role default
-- (Admin/CEO only, per canViewFolderitHr in app/lib/permissions.ts);
-- TRUE/FALSE = explicit override set from the Members > Access Matrix >
-- Folderit > HR toggle.
-- ============================================================

alter table member_permissions
  add column if not exists can_view_folderit_hr boolean default null;
