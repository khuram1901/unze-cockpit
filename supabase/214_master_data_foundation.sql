-- 214: Master data foundation (Phase 1)
-- ─────────────────────────────────────────────────────────────────
-- admin_locations becomes the single locations master:
--   + company_id FK (backfilled from entity text)
--   + flw_station — maps FlowHCM station names to locations
--   + 8 new locations FlowHCM knows but admin didn't
-- departments seeded from FlowHCM (28) with default_company_id
--   (used for Head Office staff whose company comes from department)
-- flw_employees gains is_active, leaving_date + resolved master IDs
-- resolve_flw_employee_links() RPC does all resolution in the DB.
-- Company IDs: UTPL 15884c2d…, IFPL 77921705…, HD 16a92b7f…,
--   Baranh 6401ba75…, Unze London 8a4c0f3b…, Unze Group c5ef2967…
-- ─────────────────────────────────────────────────────────────────

-- 1. admin_locations: company FK + FlowHCM station mapping
alter table admin_locations add column if not exists company_id uuid references companies(id);
alter table admin_locations add column if not exists flw_station text;
create unique index if not exists admin_locations_flw_station_uq
  on admin_locations (flw_station) where flw_station is not null;

update admin_locations set company_id = case entity
  when 'UTPL'        then '15884c2d-48a4-4d43-be90-0ef6e130790c'::uuid
  when 'IFPL'        then '77921705-8a15-4406-847a-b234f84b5ec3'::uuid
  when 'HD'          then '16a92b7f-b3fa-4271-819b-c6befb534f12'::uuid
  when 'Baranh'      then '6401ba75-f297-4617-84c1-305bcaf35a50'::uuid
  when 'Unze London' then '8a4c0f3b-5d2e-4a9f-b345-c6d7e8f90012'::uuid
  else company_id end
where company_id is null;

-- 2. Station mapping — confirmed by Khuram 30/08/2026
update admin_locations set flw_station = m.st
from (values
  ('DHA','IFPL','Store 019 DHA III Y'),
  ('Packages Mall','IFPL','Store 020 Packages Mall'),
  ('Faisalabad','IFPL','Store 022 Faisalabad'),
  ('Iqbal Town','IFPL','Store 023 (Iqbal Town)'),
  ('LDS Jhang','IFPL','Store 025 LDS Jhang'),
  ('Mall of Multan','IFPL','Store 026 Mall of Multan'),
  ('Peshawar 1','IFPL','Store 027 (Peshawar)'),
  ('Sialkot Store','IFPL','Store 029 Sialkot'),
  ('Emporium Mall','IFPL','Store 030 (Emporium Mall)'),
  ('Packages Mall Mega Store','IFPL','Store 032 Mega Packages'),
  ('Lucky One Mall','IFPL','Store 034 Lucky One Mall'),
  ('Gujranwala','IFPL','Store 041 Gujranwala'),
  ('Dolmen Mall','IFPL','Store 043 Dolman Mall'),
  ('Amanah Mall','IFPL','Store 044 Amanah Mall'),
  ('Liberty Store','IFPL','Store 045 Liberty'),
  ('Giga Mall','IFPL','Store 046 Giga Mall'),
  ('Tariq Road','IFPL','Store 047 Tariq Road Karachi'),
  ('Lake City','IFPL','Store 048 Lake City'),
  ('Sahiwal','IFPL','Store 049 Sahiwal'),
  ('Bahria Town','IFPL','Store 050 Bahria Town Lahore'),
  ('V Mall Sialkot','IFPL','Store 051 V Mall Sialkot'),
  ('Hyderabad','IFPL','Store 052 Hyderabad'),
  ('Capital Square','IFPL','Store 054 Islamabad CS'),
  ('Hakim Mall','IFPL','Store 055 Hakim Mall MB'),
  ('Mardan','IFPL','Store 056 Mardan'),
  ('Sufi City','IFPL','Store 057 Sufi City MB'),
  ('Usman Mall','IFPL','Store 058 Usman Mall MB'),
  ('Swat','IFPL','Store 059 Swat'),
  ('Kharian','IFPL','Store 060 Kharian'),
  ('Kooh I Noor','IFPL','Store 061 Faisalabad KN'),
  ('Sukkur','IFPL','Store 062 Sukkur'),
  ('Head Office','IFPL','HeadOffice'),
  ('Warehouse','IFPL','Warehouse'),
  ('Manga Warehouse','IFPL','Warehouse Manga'),
  ('Raya','Baranh','Baranh  Raya'),
  ('Gulberg','Baranh','Baranh Gulberg'),
  ('Jhang','Baranh','Baranh Jhang'),
  ('Packages Mall','Baranh','Baranh Packages'),
  ('DHA Y Block','Baranh','Baranh Y Block'),
  ('Elysian Sweets','Baranh','Elysian Sweets'),
  ('Restaurant Warehouse','Baranh','Restaurant Warehouse'),
  ('Raya','HD','Haute Dolci HD  Raya'),
  ('Dolmen Mall','HD','Haute Dolci HD Dolman'),
  ('Packages Mall','HD','Haute Dolci HD Packages'),
  ('DHA Y Block','HD','Haute Dolci HD Y Block'),
  ('MEPCO','UTPL','Unze - MEPCO'),
  ('PESCO','UTPL','Unze - PESCO')
) as m(nm, ent, st)
where admin_locations.name = m.nm and admin_locations.entity = m.ent;

-- 3. New locations FlowHCM has that admin didn't (Store 038 skipped — not yet open)
insert into admin_locations (name, entity, location_type, is_active, company_id, flw_station) values
  ('Mall of Lahore','IFPL','retail', true, '77921705-8a15-4406-847a-b234f84b5ec3','Store 021 (Mall of Lahore)'),
  ('Centaurus Mall','IFPL','retail', true, '77921705-8a15-4406-847a-b234f84b5ec3','Store 028 (Centaurs Mall)'),
  ('Avenue Mall','IFPL','retail', true, '77921705-8a15-4406-847a-b234f84b5ec3','Sore 033 (Avenue Mall)'),
  ('Bashir Mall','IFPL','retail', true, '77921705-8a15-4406-847a-b234f84b5ec3','Store 042 Bashir Mall'),
  ('Faisalabad HC','IFPL','retail', true, '77921705-8a15-4406-847a-b234f84b5ec3','Store 053 Faisalabad HC'),
  ('Gulberg','HD','restaurant', true, '16a92b7f-b3fa-4271-819b-c6befb534f12','Haute Dolci HD  Gulberg'),
  ('FESCO','UTPL','plant', true, '15884c2d-48a4-4d43-be90-0ef6e130790c','Unze - FESCO'),
  ('Ilford UK','Unze London','retail', true, '8a4c0f3b-5d2e-4a9f-b345-c6d7e8f90012','Ilford UK 005');

-- 4. Departments master with default company (for Head Office staff)
alter table departments add column if not exists default_company_id uuid references companies(id);
alter table departments add column if not exists source text default 'flowhcm';
create unique index if not exists departments_name_uq on departments (department_name);

insert into departments (department_name, active, default_company_id) values
  -- IFPL (retail side)
  ('Retail Store',            true, '77921705-8a15-4406-847a-b234f84b5ec3'),
  ('Retail Head Office',      true, '77921705-8a15-4406-847a-b234f84b5ec3'),
  ('Supply Chain',            true, '77921705-8a15-4406-847a-b234f84b5ec3'),
  ('Supply Chain Apparel',    true, '77921705-8a15-4406-847a-b234f84b5ec3'),
  ('Online',                  true, '77921705-8a15-4406-847a-b234f84b5ec3'),
  ('Warehouse',               true, '77921705-8a15-4406-847a-b234f84b5ec3'),
  ('LDS Store',               true, '77921705-8a15-4406-847a-b234f84b5ec3'),
  -- Baranh / restaurants
  ('Restaurant',              true, '6401ba75-f297-4617-84c1-305bcaf35a50'),
  ('Restaurant Head Office',  true, '6401ba75-f297-4617-84c1-305bcaf35a50'),
  ('Accounts Baranh',         true, '6401ba75-f297-4617-84c1-305bcaf35a50'),
  ('Chocofay',                true, '6401ba75-f297-4617-84c1-305bcaf35a50'),
  -- UTPL
  ('Unze Trading Operations', true, '15884c2d-48a4-4d43-be90-0ef6e130790c'),
  ('Unze Trading',            true, '15884c2d-48a4-4d43-be90-0ef6e130790c'),
  ('Unze Metering',           true, '15884c2d-48a4-4d43-be90-0ef6e130790c'),
  -- Unze London
  ('Retail Store UK',         true, '8a4c0f3b-5d2e-4a9f-b345-c6d7e8f90012'),
  ('Accounts UK',             true, '8a4c0f3b-5d2e-4a9f-b345-c6d7e8f90012'),
  -- Common → Unze Group
  ('Admin',                   true, 'c5ef2967-f06c-4302-b74f-0c096f482ffa'),
  ('HR',                      true, 'c5ef2967-f06c-4302-b74f-0c096f482ffa'),
  ('IT',                      true, 'c5ef2967-f06c-4302-b74f-0c096f482ffa'),
  ('Finance',                 true, 'c5ef2967-f06c-4302-b74f-0c096f482ffa'),
  ('Finance & Tax',           true, 'c5ef2967-f06c-4302-b74f-0c096f482ffa'),
  ('Tax',                     true, 'c5ef2967-f06c-4302-b74f-0c096f482ffa'),
  ('Internal Audit',          true, 'c5ef2967-f06c-4302-b74f-0c096f482ffa'),
  ('Management',              true, 'c5ef2967-f06c-4302-b74f-0c096f482ffa'),
  ('Marketing',               true, 'c5ef2967-f06c-4302-b74f-0c096f482ffa'),
  ('CCTV and Surveillance',   true, 'c5ef2967-f06c-4302-b74f-0c096f482ffa'),
  ('Fit Out and Maintenance', true, 'c5ef2967-f06c-4302-b74f-0c096f482ffa'),
  ('Accounts',                true, 'c5ef2967-f06c-4302-b74f-0c096f482ffa')
on conflict (department_name) do update set default_company_id = excluded.default_company_id;

-- 5. flw_employees: leaver flag + resolved master IDs
alter table flw_employees add column if not exists is_active boolean;
alter table flw_employees add column if not exists leaving_date date;
alter table flw_employees add column if not exists location_id uuid references admin_locations(id);
alter table flw_employees add column if not exists department_id uuid references departments(id);
alter table flw_employees add column if not exists company_id uuid references companies(id);
create index if not exists flw_employees_company_idx  on flw_employees (company_id);
create index if not exists flw_employees_location_idx on flw_employees (location_id);
create index if not exists flw_employees_dept_idx     on flw_employees (department_id);

-- 6. Members ↔ employee link (populated later in Phase 1)
alter table members add column if not exists employee_code text;

-- 7. Resolution RPC — all master-ID resolution happens in the database.
--    Called by the sync route after each employee upsert.
create or replace function resolve_flw_employee_links()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Location from station mapping
  update flw_employees e
  set location_id = l.id
  from admin_locations l
  where l.flw_station = e.station
    and (e.location_id is distinct from l.id);

  -- Department by exact name
  update flw_employees e
  set department_id = d.id
  from departments d
  where d.department_name = e.department
    and (e.department_id is distinct from d.id);

  -- Company: Head Office staff by department default; everyone else by
  -- location's company; fallback department default, then Unze Group.
  update flw_employees e
  set company_id = coalesce(
        case when e.station = 'HeadOffice' then d.default_company_id
             else l.company_id end,
        d.default_company_id,
        'c5ef2967-f06c-4302-b74f-0c096f482ffa'::uuid)
  from flw_employees x
  left join admin_locations l on l.id = x.location_id
  left join departments d     on d.id = x.department_id
  where e.employee_code = x.employee_code;
end;
$$;
