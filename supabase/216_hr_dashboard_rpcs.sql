-- 216: HR dashboard RPCs (Phase 2)
-- ─────────────────────────────────────────────────────────────────
-- All HR tab aggregation happens here, in the database. Each RPC
-- returns a single jsonb payload — one round trip per tab.
-- ─────────────────────────────────────────────────────────────────

-- 1. People tab: headcount overview
create or replace function get_hr_people_overview()
returns jsonb
language sql
security definer
set search_path = public
as $$
select jsonb_build_object(
  'total_active',   (select count(*) from flw_employees where is_active),
  'total_leavers',  (select count(*) from flw_employees where not is_active),
  'joined_30d',     (select count(*) from flw_employees where is_active and joining_date >= current_date - 30),
  'left_30d',       (select count(*) from flw_employees where leaving_date >= current_date - 30),
  'by_company', (
    select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'code', c.short_code, 'active', t.n) order by t.n desc), '[]'::jsonb)
    from (select company_id, count(*) n from flw_employees where is_active group by company_id) t
    join companies c on c.id = t.company_id),
  'by_department', (
    select coalesce(jsonb_agg(jsonb_build_object('name', d.department_name, 'active', t.n) order by t.n desc), '[]'::jsonb)
    from (select department_id, count(*) n from flw_employees where is_active group by department_id) t
    join departments d on d.id = t.department_id)
);
$$;

-- 2. Payroll tab: cost insights by dimension (active staff gross from salary setup)
create or replace function get_hr_payroll_insights(p_year int default null, p_month int default null)
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
)
select jsonb_build_object(
  'total_gross',   (select round(sum(gross)) from active),
  'heads_on_payroll', (select count(*) from active where gross > 0),
  'avg_cost',      (select round(avg(gross)) from active where gross > 0),
  'month_allowances', (
    select coalesce(round(sum(amount)), 0) from flw_allowances
    where (p_year is null or year = p_year) and (p_month is null or month = p_month)),
  'month_deductions', (
    select coalesce(round(sum(amount)), 0) from flw_deductions
    where (p_year is null or year = p_year) and (p_month is null or month = p_month)),
  'open_advances', (
    select coalesce(round(sum(amount)), 0) from flw_advance_salary where status = 'Approved'),
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

-- 3. Workforce movement: joiners and leavers for a period
create or replace function get_hr_movement(p_from date, p_to date)
returns jsonb
language sql
security definer
set search_path = public
as $$
select jsonb_build_object(
  'joined', (select count(*) from flw_employees where joining_date between p_from and p_to),
  'left',   (select count(*) from flw_employees where leaving_date between p_from and p_to),
  'active_now', (select count(*) from flw_employees where is_active),
  'by_department', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', d.department_name,
      'joined', coalesce(j.n, 0),
      'left',   coalesce(l.n, 0),
      'active', coalesce(a.n, 0)
    ) order by coalesce(a.n,0) desc), '[]'::jsonb)
    from departments d
    left join (select department_id, count(*) n from flw_employees where joining_date between p_from and p_to group by department_id) j on j.department_id = d.id
    left join (select department_id, count(*) n from flw_employees where leaving_date between p_from and p_to group by department_id) l on l.department_id = d.id
    left join (select department_id, count(*) n from flw_employees where is_active group by department_id) a on a.department_id = d.id
    where coalesce(j.n,0) > 0 or coalesce(l.n,0) > 0 or coalesce(a.n,0) > 0),
  'by_company', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', c.short_code,
      'joined', coalesce(j.n, 0),
      'left',   coalesce(l.n, 0),
      'active', coalesce(a.n, 0)
    ) order by coalesce(a.n,0) desc), '[]'::jsonb)
    from companies c
    left join (select company_id, count(*) n from flw_employees where joining_date between p_from and p_to group by company_id) j on j.company_id = c.id
    left join (select company_id, count(*) n from flw_employees where leaving_date between p_from and p_to group by company_id) l on l.company_id = c.id
    left join (select company_id, count(*) n from flw_employees where is_active group by company_id) a on a.company_id = c.id
    where coalesce(j.n,0) > 0 or coalesce(l.n,0) > 0 or coalesce(a.n,0) > 0)
);
$$;

-- 4. Attendance overview for a date
--    Present = has attendance row. On leave = approved leave covering the date.
--    Absent = active minus present minus on leave.
create or replace function get_hr_attendance_overview(p_date date default current_date)
returns jsonb
language sql
security definer
set search_path = public
as $$
with present as (
  select distinct employee_code from flw_attendance_daily
  where attendance_date = p_date and status = 'Present'
),
on_leave as (
  select distinct employee_code from flw_leave_requests
  where status = 'Approved' and p_date between from_date and to_date
),
active as (select employee_code, station, company_id from flw_employees where is_active)
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
