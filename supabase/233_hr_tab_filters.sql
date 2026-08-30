-- 233: HR tab filters (Khuram, 30/08/2026)
-- People: filter by company / department / station.
-- Payroll: pick any month with data + filter company / department / location.
-- Movement: filter company / department (dates already parameters).
-- Attendance: filter company / station (date already a parameter).
-- Plus get_hr_filter_options() so the tabs can populate their dropdowns in
-- one round-trip. All server-called via the service role (migration 230
-- policy): execute revoked from public/anon/authenticated.

drop function if exists get_hr_people_overview();
drop function if exists get_hr_payroll_insights(int, int);
drop function if exists get_hr_movement(date, date);
drop function if exists get_hr_attendance_overview(date);

-- ── 0. Filter options ────────────────────────────────────────────────────────
create or replace function get_hr_filter_options()
returns jsonb
language sql
security definer
set search_path = public
as $$
select jsonb_build_object(
  'companies', (
    select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'code', c.short_code) order by c.name), '[]'::jsonb)
    from companies c
    where exists (select 1 from flw_employees e where e.company_id = c.id and e.is_active)),
  'departments', (
    select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.department_name) order by d.department_name), '[]'::jsonb)
    from departments d
    where exists (select 1 from flw_employees e where e.department_id = d.id and e.is_active)),
  'stations', (
    select coalesce(jsonb_agg(to_jsonb(t.station) order by t.station), '[]'::jsonb)
    from (select distinct station from flw_employees where station is not null and is_active) t),
  'locations', (
    select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name || ' (' || l.entity || ')') order by l.name), '[]'::jsonb)
    from admin_locations l
    where exists (select 1 from flw_employees e where e.location_id = l.id and e.is_active)),
  'payroll_months', (
    select coalesce(jsonb_agg(jsonb_build_object('year', t.y, 'month', t.m) order by t.y desc, t.m desc), '[]'::jsonb)
    from (select distinct year as y, month as m from flw_allowances
          union
          select distinct year, month from flw_deductions) t)
);
$$;

-- ── 1. People overview with filters ──────────────────────────────────────────
create or replace function get_hr_people_overview(
  p_company uuid default null,
  p_department uuid default null,
  p_station text default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
with emp as (
  select * from flw_employees
  where (p_company is null or company_id = p_company)
    and (p_department is null or department_id = p_department)
    and (p_station is null or station = p_station)
)
select jsonb_build_object(
  'total_active',   (select count(*) from emp where is_active),
  'total_leavers',  (select count(*) from emp where not is_active),
  'joined_30d',     (select count(*) from emp where is_active and joining_date >= current_date - 30),
  'left_30d',       (select count(*) from emp where leaving_date >= current_date - 30),
  'by_company', (
    select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'code', c.short_code, 'active', t.n) order by t.n desc), '[]'::jsonb)
    from (select company_id, count(*) n from emp where is_active group by company_id) t
    join companies c on c.id = t.company_id),
  'by_department', (
    select coalesce(jsonb_agg(jsonb_build_object('name', d.department_name, 'active', t.n) order by t.n desc), '[]'::jsonb)
    from (select department_id, count(*) n from emp where is_active group by department_id) t
    join departments d on d.id = t.department_id)
);
$$;

-- ── 2. Payroll insights with month + filters ─────────────────────────────────
create or replace function get_hr_payroll_insights(
  p_year int default null,
  p_month int default null,
  p_company uuid default null,
  p_department uuid default null,
  p_location uuid default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
with active as (
  select e.employee_code, e.company_id, e.department_id, e.location_id,
         coalesce(s.gross_salary, 0) as gross
  from flw_employees e
  left join flw_salary_setup s on s.employee_code = e.employee_code
  where e.is_active
    and (p_company is null or e.company_id = p_company)
    and (p_department is null or e.department_id = p_department)
    and (p_location is null or e.location_id = p_location)
)
select jsonb_build_object(
  'total_gross',      (select round(sum(gross)) from active),
  'heads_on_payroll', (select count(*) from active where gross > 0),
  'avg_cost',         (select round(avg(gross)) from active where gross > 0),
  'month_allowances', (
    select coalesce(round(sum(a.amount)), 0) from flw_allowances a
    where (p_year is null or a.year = p_year) and (p_month is null or a.month = p_month)
      and ((p_company is null and p_department is null and p_location is null) or exists (
        select 1 from flw_employees e where e.employee_code = a.employee_code
          and (p_company is null or e.company_id = p_company)
          and (p_department is null or e.department_id = p_department)
          and (p_location is null or e.location_id = p_location)))),
  'month_deductions', (
    select coalesce(round(sum(d.amount)), 0) from flw_deductions d
    where (p_year is null or d.year = p_year) and (p_month is null or d.month = p_month)
      and ((p_company is null and p_department is null and p_location is null) or exists (
        select 1 from flw_employees e where e.employee_code = d.employee_code
          and (p_company is null or e.company_id = p_company)
          and (p_department is null or e.department_id = p_department)
          and (p_location is null or e.location_id = p_location)))),
  'open_advances', (
    select coalesce(round(sum(v.amount)), 0) from flw_advance_salary v
    where v.status = 'Approved'
      and ((p_company is null and p_department is null and p_location is null) or exists (
        select 1 from flw_employees e where e.employee_code = v.employee_code
          and (p_company is null or e.company_id = p_company)
          and (p_department is null or e.department_id = p_department)
          and (p_location is null or e.location_id = p_location)))),
  'by_company', (
    select coalesce(jsonb_agg(jsonb_build_object('name', c.short_code, 'heads', t.heads, 'gross', t.g) order by t.g desc), '[]'::jsonb)
    from (select company_id, count(*) heads, round(sum(gross)) g from active group by company_id) t
    join companies c on c.id = t.company_id),
  'by_department', (
    select coalesce(jsonb_agg(jsonb_build_object('name', d.department_name, 'heads', t.heads, 'gross', t.g) order by t.g desc), '[]'::jsonb)
    from (select department_id, count(*) heads, round(sum(gross)) g from active group by department_id) t
    join departments d on d.id = t.department_id),
  'by_location', (
    select coalesce(jsonb_agg(jsonb_build_object('name', l.name || ' (' || l.entity || ')', 'type', l.location_type, 'heads', t.heads, 'gross', t.g) order by t.g desc), '[]'::jsonb)
    from (select location_id, count(*) heads, round(sum(gross)) g from active where location_id is not null group by location_id) t
    join admin_locations l on l.id = t.location_id)
);
$$;

-- ── 3. Movement with filters ─────────────────────────────────────────────────
create or replace function get_hr_movement(
  p_from date,
  p_to date,
  p_company uuid default null,
  p_department uuid default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
with emp as (
  select * from flw_employees
  where (p_company is null or company_id = p_company)
    and (p_department is null or department_id = p_department)
)
select jsonb_build_object(
  'joined', (select count(*) from emp where joining_date between p_from and p_to),
  'left',   (select count(*) from emp where leaving_date between p_from and p_to),
  'active_now', (select count(*) from emp where is_active),
  'by_department', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', d.department_name,
      'joined', coalesce(j.n, 0),
      'left',   coalesce(l.n, 0),
      'active', coalesce(a.n, 0)
    ) order by coalesce(a.n,0) desc), '[]'::jsonb)
    from departments d
    left join (select department_id, count(*) n from emp where joining_date between p_from and p_to group by department_id) j on j.department_id = d.id
    left join (select department_id, count(*) n from emp where leaving_date between p_from and p_to group by department_id) l on l.department_id = d.id
    left join (select department_id, count(*) n from emp where is_active group by department_id) a on a.department_id = d.id
    where coalesce(j.n,0) > 0 or coalesce(l.n,0) > 0 or coalesce(a.n,0) > 0),
  'by_company', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', c.short_code,
      'joined', coalesce(j.n, 0),
      'left',   coalesce(l.n, 0),
      'active', coalesce(a.n, 0)
    ) order by coalesce(a.n,0) desc), '[]'::jsonb)
    from companies c
    left join (select company_id, count(*) n from emp where joining_date between p_from and p_to group by company_id) j on j.company_id = c.id
    left join (select company_id, count(*) n from emp where leaving_date between p_from and p_to group by company_id) l on l.company_id = c.id
    left join (select company_id, count(*) n from emp where is_active group by company_id) a on a.company_id = c.id
    where coalesce(j.n,0) > 0 or coalesce(l.n,0) > 0 or coalesce(a.n,0) > 0)
);
$$;

-- ── 4. Attendance with filters ───────────────────────────────────────────────
create or replace function get_hr_attendance_overview(
  p_date date default current_date,
  p_company uuid default null,
  p_station text default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
with active as (
  select employee_code, station, company_id from flw_employees
  where is_active
    and (p_company is null or company_id = p_company)
    and (p_station is null or station = p_station)
),
present as (
  select distinct employee_code from flw_attendance_daily
  where attendance_date = p_date and status = 'Present'
),
on_leave as (
  select distinct employee_code from flw_leave_requests
  where status = 'Approved' and p_date between from_date and to_date
)
select jsonb_build_object(
  'date', p_date,
  'active', (select count(*) from active),
  'present', (select count(*) from present p join active a on a.employee_code = p.employee_code),
  'on_leave', (select count(*) from on_leave o join active a on a.employee_code = o.employee_code),
  'absent', (
    select count(*) from active a
    where a.employee_code not in (select employee_code from present)
      and a.employee_code not in (select employee_code from on_leave)),
  'by_station_absence', (
    select coalesce(jsonb_agg(jsonb_build_object('station', s.station, 'active', s.total, 'absent', s.miss) order by s.miss desc), '[]'::jsonb)
    from (
      select a.station, count(*) total,
             count(*) filter (where a.employee_code not in (select employee_code from present)
                                and a.employee_code not in (select employee_code from on_leave)) miss
      from active a
      where a.station is not null
      group by a.station
      having count(*) filter (where a.employee_code not in (select employee_code from present)
                                and a.employee_code not in (select employee_code from on_leave)) > 0
      order by miss desc
      limit 10
    ) s)
);
$$;

-- ── Lockdown (migration 230 policy): server-only ─────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'get_hr_filter_options()',
    'get_hr_people_overview(uuid, uuid, text)',
    'get_hr_payroll_insights(int, int, uuid, uuid, uuid)',
    'get_hr_movement(date, date, uuid, uuid)',
    'get_hr_attendance_overview(date, uuid, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end $$;
