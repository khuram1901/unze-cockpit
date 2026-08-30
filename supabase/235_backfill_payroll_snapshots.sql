-- 235: Backfill hr_payroll_snapshots for Jul 2025–Jul 2026
-- FlowHCM keeps no salary history; prior months use current salary setup
-- as a baseline estimate. is_estimate = true marks these months in the UI.

alter table public.hr_payroll_snapshots
  add column if not exists is_estimate boolean not null default false;

-- Seed Jul 2025 – Jul 2026 with current salary setup as approximation
with months as (
  select generate_series(
    '2025-07-01'::date,
    (date_trunc('month', current_date) - interval '1 month')::date,
    interval '1 month'
  )::date as month
),
company_payroll as (
  select
    e.company_id,
    coalesce(sum(s.gross_salary), 0) as gross,
    count(*) as heads
  from flw_employees e
  left join flw_salary_setup s on s.employee_code = e.employee_code
  where e.is_active and e.company_id is not null
  group by e.company_id
)
insert into hr_payroll_snapshots (month, company_id, gross, heads, is_estimate)
select m.month, cp.company_id, cp.gross, cp.heads, true
from months m
cross join company_payroll cp
on conflict (month, company_id) do update
  set gross = excluded.gross,
      heads = excluded.heads,
      is_estimate = excluded.is_estimate;
