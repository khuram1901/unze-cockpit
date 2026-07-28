-- Restaurants P&L (28/07/2026) — Baranh + Haute Dolci on one page at
-- /finance/restaurants, one tab per company (K&K Jhang parked for now, the
-- schema takes it without change: company is a text key). Same pattern as
-- Imperial (migration 144): month × branch × line grain, browser-side
-- parsing, per-month validation, RPCs company-parameterised. Restaurant
-- files carry ACTUALS only (no projections), so the page follows the Unze
-- trend style rather than Imperial's plan-vs-actual.
--
--   company  'BARANH' | 'HD'   (future: 'KK')
--
-- Access: new can_view_restaurants_pnl permission — Admin/CEO by default,
-- everyone else via the Access Matrix toggle. PA blocked in code (rule 6).
-- RLS enabled, no policies (reads via definer RPCs, writes via service
-- role). All RPCs anon-revoked per the migration 149 pattern. Apply
-- manually via the Supabase SQL Editor.

create table if not exists rest_pnl_uploads (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  month date not null,
  file_name text not null,
  status text not null,
  checks_passed integer not null default 0,
  checks_failed integer not null default 0,
  warnings integer not null default 0,
  rejection_summary text,
  uploaded_by text,
  uploaded_at timestamptz not null default now()
);

create table if not exists rest_pnl_lines (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references rest_pnl_uploads(id) on delete cascade,
  company text not null,
  month date not null,
  branch text not null,
  line text not null,
  category text not null,
  amount numeric not null default 0
);

create table if not exists rest_pnl_checks (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references rest_pnl_uploads(id) on delete cascade,
  check_name text not null,
  expected numeric,
  reported numeric,
  diff numeric,
  passed boolean not null,
  blocking boolean not null default true
);

create index if not exists idx_rest_lines_company_month on rest_pnl_lines (company, month);
create index if not exists idx_rest_lines_branch on rest_pnl_lines (branch);
create index if not exists idx_rest_lines_line on rest_pnl_lines (line);

alter table rest_pnl_uploads enable row level security;
alter table rest_pnl_lines enable row level security;
alter table rest_pnl_checks enable row level security;

alter table member_permissions add column if not exists can_view_restaurants_pnl boolean;

-- ── Read RPCs ────────────────────────────────────────────────────────

create or replace function rest_kpi_by_month(p_company text, p_from date, p_to date, p_branch text default 'All')
returns table (
  month date,
  net_sales numeric, total_cogs numeric, gross_profit numeric,
  admin_expenses numeric, op_profit numeric, net_profit numeric
)
security definer
set search_path = public
language sql
as $$
  select
    month,
    sum(amount) filter (where line = 'Net Sales'),
    sum(amount) filter (where line = 'Total Cost of Goods Sold'),
    sum(amount) filter (where line = 'Gross Profit'),
    sum(amount) filter (where line = 'Total Administrative Expenses'),
    sum(amount) filter (where line = 'Profit after Operations'),
    sum(amount) filter (where line = 'Net Profit')
  from rest_pnl_lines
  where company = p_company
    and month between p_from and p_to
    and (p_branch = 'All' or branch = p_branch)
  group by month
  order by month;
$$;

create or replace function rest_branch_league(p_company text, p_from date, p_to date)
returns table (branch text, net_sales numeric, gross_profit numeric, net_profit numeric)
security definer
set search_path = public
language sql
as $$
  select
    branch,
    sum(amount) filter (where line = 'Net Sales'),
    sum(amount) filter (where line = 'Gross Profit'),
    sum(amount) filter (where line = 'Net Profit')
  from rest_pnl_lines
  where company = p_company
    and month between p_from and p_to
  group by branch
  order by 2 desc nulls last;
$$;

create or replace function rest_line_totals(p_company text, p_from date, p_to date, p_branch text default 'All')
returns table (line text, category text, amount numeric)
security definer
set search_path = public
language sql
as $$
  select line, category, sum(amount)
  from rest_pnl_lines
  where company = p_company
    and month between p_from and p_to
    and category in ('expense', 'cogs_detail', 'below_less', 'below_add')
    and (p_branch = 'All' or branch = p_branch)
  group by line, category
  order by 3 desc;
$$;

create or replace function rest_validation_summary(p_company text)
returns table (
  month date, file_name text, status text,
  checks_passed integer, checks_failed integer, warnings integer,
  uploaded_at timestamptz
)
security definer
set search_path = public
language sql
as $$
  select distinct on (month)
    month, file_name, status, checks_passed, checks_failed, warnings, uploaded_at
  from rest_pnl_uploads
  where company = p_company
  order by month, uploaded_at desc;
$$;

create or replace function rest_check_details(p_company text)
returns table (month date, check_name text, expected numeric, reported numeric, diff numeric, blocking boolean, status text)
security definer
set search_path = public
language sql
as $$
  select u.month, c.check_name, c.expected, c.reported, c.diff, c.blocking, u.status
  from rest_pnl_checks c
  join rest_pnl_uploads u on u.id = c.upload_id
  where c.passed = false
    and u.company = p_company
    and u.uploaded_at = (select max(u2.uploaded_at) from rest_pnl_uploads u2 where u2.company = u.company and u2.month = u.month)
  order by u.month, c.blocking desc, c.check_name;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'rest_kpi_by_month(text, date, date, text)',
    'rest_branch_league(text, date, date)',
    'rest_line_totals(text, date, date, text)',
    'rest_validation_summary(text)',
    'rest_check_details(text)'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;
