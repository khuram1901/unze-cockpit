-- The Access Matrix's "Targets" toggle (Production group) and
-- canEditOperationsTargets() in permissions.ts have referenced
-- can_edit_operations_targets on member_permissions since it was added to
-- the UI/permission-check code — but no migration ever actually created
-- the column. Every attempt to toggle it for someone (e.g. Nadeem Khan)
-- fails with "Could not find the 'can_edit_operations_targets' column of
-- 'member_permissions' in the schema cache."
--
-- Matches the existing convention for every other override column here:
-- nullable boolean, no default (null = "no override, use the role-based
-- default computed in code").

alter table public.member_permissions
  add column if not exists can_edit_operations_targets boolean;
