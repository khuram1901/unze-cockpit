-- 226: Director role + HOD flags (Khuram 09/09/2026) — applied via MCP
-- Director sits above Manager as a department head role. In code,
-- isManagerTier() (permissions.ts) makes every department-scoped
-- Manager check accept Director too. Admin/CEO can assign the role.
-- NOTE: the RLS helper functions is_finance_manager()/is_ops_manager()
-- still check role='Manager' only — extend them if a Director ever
-- needs Finance/Ops row-level access.
alter table members drop constraint if exists members_role_check;
alter table members add constraint members_role_check
  check (role = any (array['Admin'::text,'CEO'::text,'Executive'::text,'Director'::text,'Manager'::text,'Member'::text]));
update members set role = 'Director' where lower(email) = 'abbasi@unze.co.uk';
update members set is_hod = true where lower(email) in ('amir.ahmad@unze.co.uk', 'wajid@unze.co.uk');
