-- Migration 294 (+ 294b correction): Gate manager-chain RLS clauses for users with explicit
-- can_see_all_tasks = false override (e.g. Kamran, CEO of IFPL).
--
-- Problem: is_in_manager_chain() and is_manager_of_creator() were unconditional in the
-- tasks_select policy. Kamran (can_see_all_tasks=false, 12 direct reports) could see
-- every task assigned to or created by his reports even though his override says "own only".
--
-- Fix: gate both manager-chain clauses with perm_override('can_see_all_tasks') IS NOT FALSE.
--   perm_override = false (Kamran)         → false IS NOT FALSE = false → blocked ✅
--   perm_override = null  (all managers)   → null  IS NOT FALSE = true  → allowed ✅
--   perm_override = true  (explicit grant) → true  IS NOT FALSE = true  → allowed ✅
--
-- Note: in practice all managers have can_see_all_tasks=false in member_permissions, so
-- they were already relying on the client-side myReportEmails query clause for team
-- visibility — this RLS clause was functionally unreachable for them. This change is
-- therefore safe with no regression.
--
-- Migration 294 (first attempt) gated behind can_access_all_tasks() which was too broad.
-- This corrected version uses perm_override() directly to target only explicit false.

DROP POLICY IF EXISTS tasks_select ON tasks;

CREATE POLICY tasks_select ON tasks
  FOR SELECT USING (
    can_access_all_tasks()
    OR assigned_to_email = (SELECT auth.email())
    OR assigned_by = (SELECT name FROM members WHERE email = (SELECT auth.email()))
    OR is_task_assignee(id)
    OR is_task_creator(id)
    -- Manager-chain: visible unless user has an explicit can_see_all_tasks=false override
    OR (perm_override('can_see_all_tasks') IS NOT FALSE AND is_in_manager_chain(assigned_to_email))
    OR (perm_override('can_see_all_tasks') IS NOT FALSE AND is_manager_of_creator(assigned_by_email))
  );
