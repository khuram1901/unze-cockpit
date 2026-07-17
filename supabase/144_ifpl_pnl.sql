-- Imperial Footwear (Unze London retail) P&L — schema, RPCs and access
-- (17/07/2026). Data comes from the cumulative PL-CURRENT.xlsx workbook via
-- /api/pnl/upload-ifpl: one upload row per month, lines at month × branch ×
-- line grain with BOTH projection and actual (plan-vs-actual is the spine
-- of this page, unlike Unze Trading which has no budget in its file).
--
-- Access: page is limited to Khuram, Kamran, Shakeel and Shahida. Admin +
-- CEO roles pass by default in canViewIfplPnl(); Shakeel and Shahida
-- (Managers) are granted per-member overrides below. PA can never see it.
--
-- RLS is enabled with no policies: reads go through the security-definer
-- RPCs, writes through the service client. Apply manually via the Supabase
-- SQL Editor after 143 — do not auto-run.

create table if not exists ifpl_pnl_uploads (
  id uuid primary key default gen_random_uuid(),
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

create table if not exists ifpl_pnl_lines (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references ifpl_pnl_uploads(id) on delete cascade,
  month date not null,
  branch text not null,
  channel text not null,
  line text not null,
  category text not null,
  projection numeric not null default 0,
  actual numeric not null default 0
);

create table if not exists ifpl_pnl_checks (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references ifpl_pnl_uploads(id) on delete cascade,
  check_name text not null,
  expected numeric,
  reported numeric,
  diff numeric,
  passed boolean not null,
  blocking boolean not null default true
);

create index if not exists idx_ifpl_lines_month on ifpl_pnl_lines (month);
create index if not exists idx_ifpl_lines_branch on ifpl_pnl_lines (branch);
create index if not exists idx_ifpl_lines_line on ifpl_pnl_lines (line);

alter table ifpl_pnl_uploads enable row level security;
alter table ifpl_pnl_lines enable row level security;
alter table ifpl_pnl_checks enable row level security;

-- Named-access permission column + grants for the two Manager accounts.
alter table member_permissions add column if not exists can_view_ifpl_pnl boolean;
update member_permissions mp
set can_view_ifpl_pnl = true
from members m
where m.id = mp.member_id
  and lower(m.email) in ('shakeel@unze.co.uk', 'shahida.naseem@unze.co.uk');

-- ── Read RPCs ────────────────────────────────────────────────────────

create or replace function ifpl_kpi_by_month(p_from date, p_to date, p_channel text default 'All', p_branch text default 'All')
returns table (
  month date,
  proj_sales numeric, act_sales numeric,
  proj_gp numeric, act_gp numeric,
  proj_overheads numeric, act_overheads numeric,
  proj_final numeric, act_final numeric
)
security definer
set search_path = public
language sql
as $$
  select
    month,
    sum(projection) filter (where line = 'Net Sales'),
    sum(actual)     filter (where line = 'Net Sales'),
    sum(projection) filter (where line = 'Gross Profit'),
    sum(actual)     filter (where line = 'Gross Profit'),
    sum(projection) filter (where line = 'Total Overheads'),
    sum(actual)     filter (where line = 'Total Overheads'),
    sum(projection) filter (where line = 'Final Profit'),
    sum(actual)     filter (where line = 'Final Profit')
  from ifpl_pnl_lines
  where month between p_from and p_to
    and (p_channel = 'All' or channel = p_channel)
    and (p_branch = 'All' or branch = p_branch)
  group by month
  order by month;
$$;

create or replace function ifpl_branch_league(p_from date, p_to date)
returns table (
  branch text, channel text,
  proj_sales numeric, act_sales numeric,
  act_gp numeric, act_final numeric
)
security definer
set search_path = public
language sql
as $$
  select
    branch, channel,
    sum(projection) filter (where line = 'Net Sales'),
    sum(actual)     filter (where line = 'Net Sales'),
    sum(actual)     filter (where line = 'Gross Profit'),
    sum(actual)     filter (where line = 'Final Profit')
  from ifpl_pnl_lines
  where month between p_from and p_to
  group by branch, channel
  order by 4 desc nulls last;
$$;

create or replace function ifpl_line_totals(p_from date, p_to date, p_channel text default 'All', p_branch text default 'All')
returns table (line text, category text, projection numeric, actual numeric)
security definer
set search_path = public
language sql
as $$
  select line, category, sum(projection), sum(actual)
  from ifpl_pnl_lines
  where month between p_from and p_to
    and category in ('overhead', 'below_add', 'below_less')
    and (p_channel = 'All' or channel = p_channel)
    and (p_branch = 'All' or branch = p_branch)
  group by line, category
  order by 4 desc;
$$;

create or replace function ifpl_validation_summary()
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
  from ifpl_pnl_uploads
  order by month, uploaded_at desc;
$$;
