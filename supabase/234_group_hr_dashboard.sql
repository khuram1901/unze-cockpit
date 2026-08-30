-- 234: Group HR dashboard (Khuram's "Option C", 30/08/2026)
-- A separate, access-gated CEO page (/group-hr): dark group strip + company
-- scoreboard cards + payroll trend + 12-month movement + turnover league.
--
-- Payroll trend: FlowHCM keeps NO salary history, so hr_payroll_snapshots
-- captures the per-company gross once per sync run (snapshot_group_payroll()
-- is called from the FlowHCM sync after every employee sync — idempotent
-- upsert on (month, company_id)). The trend grows one column per month from
-- August 2026 (seeded below).
--
-- Access: Admin/CEO by default; others via the Access Matrix toggle
-- member_permissions.can_view_group_hr (canViewIfplPnl model — PA blocked
-- unconditionally, rule 6: payroll figures are financial data).

alter table public.member_permissions
  add column if not exists can_view_group_hr boolean;

create table if not exists public.hr_payroll_snapshots (
  month       date not null,               -- first day of month
  company_id  uuid not null references companies(id),
  gross       numeric not null default 0,
  heads       int not null default 0,
  captured_at timestamptz not null default now(),
  primary key (month, company_id)
);
alter table public.hr_payroll_snapshots enable row level security;

-- ── Capture the current month's per-company payroll ─────────────────────────
create or replace function public.snapshot_group_payroll()
returns void
language sql
security definer
set search_path = public
as $$
  insert into hr_payroll_snapshots (month, company_id, gross, heads)
  select date_trunc('month', current_date)::date,
         e.company_id,
         coalesce(sum(s.gross_salary), 0),
         count(*)
  from flw_employees e
  left join flw_salary_setup s on s.employee_code = e.employee_code
  where e.is_active and e.company_id is not null
  group by e.company_id
  on conflict (month, company_id) do update
    set gross = excluded.gross, heads = excluded.heads, captured_at = now();
$$;

-- Seed the first snapshot (August 2026)
select snapshot_group_payroll();

-- ── The whole dashboard in one round-trip ───────────────────────────────────
create or replace function public.get_group_hr_dashboard(
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
),
active as (
  select e.employee_code, e.company_id, e.joining_date,
         coalesce(s.gross_salary, 0) as gross
  from emp e
  left join flw_salary_setup s on s.employee_code = e.employee_code
  where e.is_active
),
present as (
  select distinct employee_code from flw_attendance_daily
  where attendance_date = current_date and status = 'Present'
),
on_leave as (
  select distinct employee_code from flw_leave_requests
  where status = 'Approved' and current_date between from_date and to_date
)
select jsonb_build_object(
  'as_of', current_date,
  'group', jsonb_build_object(
    'gross',            (select coalesce(round(sum(gross)), 0) from active),
    'heads',            (select count(*) from active),
    'heads_on_payroll', (select count(*) from active where gross > 0),
    'avg_cost',         (select coalesce(round(avg(gross)), 0) from active where gross > 0),
    'joined_30d',       (select count(*) from emp where is_active and joining_date >= current_date - 30),
    'left_30d',         (select count(*) from emp where leaving_date >= current_date - 30),
    'turnover_pct', (
      select case when count(*) filter (where is_active) > 0
        then round(100.0 * count(*) filter (where leaving_date >= current_date - 30)
                   / count(*) filter (where is_active), 1)
        else 0 end
      from emp),
    'present_today',  (select count(*) from present p join active a on a.employee_code = p.employee_code),
    'on_leave_today', (select count(*) from on_leave o join active a on a.employee_code = o.employee_code)
  ),
  'companies', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'code', c.short_code,
      'active',     m.heads,
      'gross',      coalesce(g.gross, 0),
      'cost_head',  case when coalesce(g.paid, 0) > 0 then round(g.gross / g.paid) else 0 end,
      'joined_30d', m.j,
      'left_30d',   m.l,
      'turnover_pct', case when m.heads > 0 then round(100.0 * m.l / m.heads, 1) else 0 end
    ) order by m.heads desc), '[]'::jsonb)
    from (
      select e.company_id,
             count(*) filter (where e.is_active) as heads,
             count(*) filter (where e.is_active and e.joining_date >= current_date - 30) as j,
             count(*) filter (where e.leaving_date >= current_date - 30) as l
      from emp e
      where e.company_id is not null
      group by e.company_id
    ) m
    left join (
      select a.company_id, round(sum(a.gross)) as gross, count(*) filter (where a.gross > 0) as paid
      from active a
      where a.company_id is not null
      group by a.company_id
    ) g on g.company_id = m.company_id
    join companies c on c.id = m.company_id
    where m.heads > 0 or m.l > 0),
  'payroll_trend', (
    -- Snapshots are per company (not per department), so only the company
    -- filter applies here; a department filter leaves the trend group-wide.
    select coalesce(jsonb_agg(jsonb_build_object(
      'month', x.month, 'total', x.total, 'by_company', x.by_company
    ) order by x.month), '[]'::jsonb)
    from (
      select s.month, round(sum(s.gross)) as total,
             jsonb_agg(jsonb_build_object('code', c.short_code, 'gross', round(s.gross)) order by s.gross desc) as by_company
      from hr_payroll_snapshots s
      join companies c on c.id = s.company_id
      where (p_company is null or s.company_id = p_company)
      group by s.month
    ) x),
  'movement_12m', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'month', to_char(d.d, 'YYYY-MM'),
      'joined', coalesce(j.n, 0),
      'left',   coalesce(l.n, 0)
    ) order by d.d), '[]'::jsonb)
    from generate_series(
      date_trunc('month', current_date) - interval '11 months',
      date_trunc('month', current_date),
      interval '1 month') d(d)
    left join (select date_trunc('month', joining_date) m, count(*) n from emp where joining_date is not null group by 1) j on j.m = d.d
    left join (select date_trunc('month', leaving_date) m, count(*) n from emp where leaving_date is not null group by 1) l on l.m = d.d)
);
$$;

-- ── Lockdown (migration 230 policy): server-only ─────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'snapshot_group_payroll()',
    'get_group_hr_dashboard(uuid, uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end $$;
