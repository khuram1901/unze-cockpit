-- Migration 224: Stop FlowHCM from auto-creating departments
-- Applied: 2026-10-14
--
-- The resolve_flw_employee_links() RPC (called every 2 hours during sync)
-- contained an INSERT that auto-seeded any new department from FlowHCM into
-- the departments table. This meant FlowHCM was the source of truth for
-- departments — overriding our curated list.
--
-- This migration removes that INSERT block. The departments table is now
-- 100% manually managed (source = 'manual'). FlowHCM can still link
-- flw_employees.department_id to existing departments, but it can no longer
-- create new ones.
--
-- The rest of resolve_flw_employee_links() is unchanged:
--   - Auto-create admin_locations for new inferable stations (kept)
--   - Update flw_employees.location_id  (kept)
--   - Update flw_employees.department_id — links to existing rows only (kept)
--   - Update flw_employees.company_id   (kept)

create or replace function resolve_flw_employee_links()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 0. Auto-create locations for new inferable stations (active staff only)
  with unmapped as (
    select e.station, count(*) filter (where e.is_active) n_active
    from flw_employees e
    where e.station is not null
      and e.station not in ('Store 038', 'BAFARZOON', 'Retail')
      and not exists (
        select 1 from admin_locations l
        where regexp_replace(l.flw_station, '\s+', ' ', 'g') = regexp_replace(e.station, '\s+', ' ', 'g'))
    group by e.station
    having count(*) filter (where e.is_active) > 0
  ),
  inferred as (
    select station,
      case
        when station ~* '^(store|sore)\s+\d+' then 'retail'
        when station ~* '^(baranh|elysian)'   then 'restaurant'
        when station ~* '^haute dolci'        then 'restaurant'
        when station ~* '^unze\s*-'           then 'plant'
        when station ~* 'warehouse'           then 'warehouse'
        else null
      end as loc_type,
      case
        when station ~* '^(store|sore)\s+\d+' then 'IFPL'
        when station ~* '^(baranh|elysian)'   then 'Baranh'
        when station ~* '^haute dolci'        then 'HD'
        when station ~* '^unze\s*-'           then 'UTPL'
        when station ~* 'warehouse'           then 'IFPL'
        else null
      end as ent,
      -- Clean display name: strip 'Store NNN ' prefix and parentheses
      nullif(trim(regexp_replace(regexp_replace(station, '^(Store|Sore)\s+\d+\s*', '', 'i'), '[()]', '', 'g')), '') as clean_name
    from unmapped
  ),
  created as (
    insert into admin_locations (name, entity, location_type, is_active, company_id, flw_station)
    select coalesce(i.clean_name, i.station), i.ent, i.loc_type, true,
      case i.ent
        when 'IFPL'   then '77921705-8a15-4406-847a-b234f84b5ec3'::uuid
        when 'Baranh' then '6401ba75-f297-4617-84c1-305bcaf35a50'::uuid
        when 'HD'     then '16a92b7f-b3fa-4271-819b-c6befb534f12'::uuid
        when 'UTPL'   then '15884c2d-48a4-4d43-be90-0ef6e130790c'::uuid
      end,
      i.station
    from inferred i
    where i.loc_type is not null
    returning flw_station, name, entity, location_type
  )
  insert into flw_lifecycle_events (employee_code, event_type, detail)
  select null, 'location_created',
         'New location auto-created from FlowHCM station "' || flw_station || '" → ' || name || ' (' || entity || ', ' || location_type || ')'
  from created;

  -- 0b. Log stations we could not infer (once per 7 days per station)
  insert into flw_lifecycle_events (employee_code, event_type, detail)
  select null, 'station_unmapped', 'FlowHCM station "' || e.station || '" has active staff but no location mapping'
  from (
    select station from flw_employees
    where station is not null and is_active
      and station not in ('Store 038', 'BAFARZOON', 'Retail')
    group by station
  ) e
  where not exists (
      select 1 from admin_locations l
      where regexp_replace(l.flw_station, '\s+', ' ', 'g') = regexp_replace(e.station, '\s+', ' ', 'g'))
    and not exists (
      select 1 from flw_lifecycle_events ev
      where ev.event_type = 'station_unmapped' and ev.detail like '%"' || e.station || '"%'
        and ev.created_at > now() - interval '7 days');

  -- 1. Location from station mapping (whitespace-insensitive)
  update flw_employees e
  set location_id = l.id
  from admin_locations l
  where regexp_replace(l.flw_station, '\s+', ' ', 'g') = regexp_replace(e.station, '\s+', ' ', 'g')
    and (e.location_id is distinct from l.id);

  -- 2. Link flw_employees to existing departments (read-only — no auto-create)
  -- NOTE: The INSERT that used to auto-seed new FlowHCM departments into the
  -- departments table has been intentionally removed (migration 224).
  -- Departments are now managed manually only.
  update flw_employees e
  set department_id = d.id
  from departments d
  where d.department_name = e.department
    and (e.department_id is distinct from d.id);

  -- 3. Company resolution
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
