-- Migration 110: Cleanup following Khuram's review of the org structure work (109)
--
-- Two things Khuram flagged as redundant once the manager_id/HOD chain
-- exists:
--
-- 1. Secondary Owner and Escalation Owner on department_owners. Confirmed
--    via a full codebase search: neither is read anywhere except the
--    Members screen that sets them — no notification, no escalation logic,
--    nothing. Escalation Owner in particular was meant to do exactly what
--    the new manager_id/HOD chain now does properly (route to the right
--    person when something needs attention), just never wired up. Primary
--    Owner IS actively used (Executive Dashboard department cards, cash-
--    escalation fallback contact in home/page.tsx) and stays.
--
-- 2. is_director on members. Added in 109 for a distinct "Director" tier
--    above HOD — Khuram then pointed out Director is really just Kamran's
--    own title sitting at the top of the chain next to Khuram's CEO title,
--    not a rank other people occupy. The org chart already handles any
--    depth from manager_id alone, so the flag isn't needed.
--
-- Apply via Supabase SQL Editor, after 109.

begin;

alter table public.department_owners
  drop column if exists secondary_owner_member_id,
  drop column if exists secondary_owner_name,
  drop column if exists secondary_owner_email,
  drop column if exists escalation_owner_member_id,
  drop column if exists escalation_owner_name,
  drop column if exists escalation_owner_email;

alter table public.members
  drop column if exists is_director;

commit;
