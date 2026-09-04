-- Migration 240: update get_hr_filter_options to include per-company
-- department_ids and stations arrays, enabling cascade filtering in the UI.

CREATE OR REPLACE FUNCTION public.get_hr_filter_options()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
select jsonb_build_object(
  'companies', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id',             c.id,
        'name',           c.name,
        'code',           c.short_code,
        'department_ids', (
          select coalesce(jsonb_agg(to_jsonb(d.department_id::text)), '[]'::jsonb)
          from (select distinct department_id
                from flw_employees e
                where e.company_id = c.id
                  and e.is_active
                  and e.department_id is not null) d
        ),
        'stations', (
          select coalesce(jsonb_agg(to_jsonb(s.station) order by s.station), '[]'::jsonb)
          from (select distinct station
                from flw_employees e
                where e.company_id = c.id
                  and e.is_active
                  and e.station is not null) s
        )
      ) order by c.name
    ), '[]'::jsonb)
    from companies c
    where exists (
      select 1 from flw_employees e where e.company_id = c.id and e.is_active
    )
  ),
  'departments', (
    select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.department_name) order by d.department_name), '[]'::jsonb)
    from departments d
    where exists (select 1 from flw_employees e where e.department_id = d.id and e.is_active)
  ),
  'stations', (
    select coalesce(jsonb_agg(to_jsonb(t.station) order by t.station), '[]'::jsonb)
    from (select distinct station from flw_employees where station is not null and is_active) t
  ),
  'locations', (
    select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name || ' (' || l.entity || ')') order by l.name), '[]'::jsonb)
    from admin_locations l
    where exists (select 1 from flw_employees e where e.location_id = l.id and e.is_active)
  ),
  'payroll_months', (
    select coalesce(jsonb_agg(jsonb_build_object('year', t.y, 'month', t.m) order by t.y desc, t.m desc), '[]'::jsonb)
    from (
      select distinct year as y, month as m from flw_allowances
      union
      select distinct year, month from flw_deductions
    ) t
  )
);
$$;
