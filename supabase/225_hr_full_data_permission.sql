-- 225: Three-tier employee data access (Khuram 09/09/2026)
-- Applied via Supabase MCP same day.
--   FULL data  : Admin/CEO + HR Managers + can_view_hr_full_data grantees
--                (initially Ghanwa ghanwa@unze.co.uk, Salman salman.tariq@unze.co.uk)
--   NAMES ONLY : rest of HR department — people_list serves limited columns
--                (code, name, designation, department, station) so the
--                EmployeePicker keeps working; no contact/financial data
--   NOTHING    : everyone outside HR, incl. other Managers and PA
-- Enforced in getMemberAccess() (app/lib/api-auth.ts) and used by
-- /api/hr/overview, /api/flowhcm/data and /api/hr/performance/*.
-- Toggle exposed in the Access Matrix (MemberDrawer → Departments →
-- "Full employee data") so grants are managed without code changes.
alter table member_permissions add column if not exists can_view_hr_full_data boolean;

insert into member_permissions (member_id, can_view_hr_full_data)
select m.id, true from members m
where lower(m.email) in ('ghanwa@unze.co.uk', 'salman.tariq@unze.co.uk')
on conflict (member_id) do update set can_view_hr_full_data = true;
