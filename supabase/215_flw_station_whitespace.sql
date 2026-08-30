-- 215: Whitespace-insensitive station matching (applied 30/08/2026)
-- FlowHCM station names contain inconsistent double spaces ("Haute Dolci HD  Raya").
-- Fixed the affected mappings and made resolve_flw_employee_links() compare
-- whitespace-normalised values so future variations still match.
-- See migration in Supabase: flw_station_whitespace_insensitive
-- (full SQL identical to what was applied via MCP — kept here for the record)

update admin_locations al set flw_station = (
  select e.station from flw_employees e
  where regexp_replace(e.station, '\s+', ' ', 'g') = 'Haute Dolci HD Raya' limit 1)
where al.name = 'Raya' and al.entity = 'HD';

update admin_locations al set flw_station = (
  select e.station from flw_employees e
  where regexp_replace(e.station, '\s+', ' ', 'g') = 'Haute Dolci HD Gulberg' limit 1)
where al.name = 'Gulberg' and al.entity = 'HD';

update admin_locations al set flw_station = (
  select e.station from flw_employees e
  where regexp_replace(e.station, '\s+', ' ', 'g') = 'Baranh Raya' limit 1)
where al.name = 'Raya' and al.entity = 'Baranh';

create or replace function resolve_flw_employee_links()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update flw_employees e
  set location_id = l.id
  from admin_locations l
  where regexp_replace(l.flw_station, '\s+', ' ', 'g') = regexp_replace(e.station, '\s+', ' ', 'g')
    and (e.location_id is distinct from l.id);

  update flw_employees e
  set department_id = d.id
  from departments d
  where d.department_name = e.department
    and (e.department_id is distinct from d.id);

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
