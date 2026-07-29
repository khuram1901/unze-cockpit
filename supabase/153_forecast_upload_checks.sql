-- Cash flow forecast upload record + calculation checks (29/07/2026).
-- Khuram: "tests the calculations, to ensure the correct sums are done and
-- then records the figures on the records." Every forecast upload is now
-- logged with its per-month check results (total inflow/outflow sums, net
-- cash flow, closing balance, month chaining). Internally inconsistent
-- files are rejected before anything reaches monthly_budgets.
--
-- RLS enabled, no policies (service-role writes, definer RPC reads,
-- anon revoked per the 149 pattern). Apply manually via the Supabase SQL
-- Editor.

create table if not exists forecast_uploads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  file_name text not null,
  status text not null,           -- accepted | rejected
  months integer not null default 0,
  categories integer not null default 0,
  checks_passed integer not null default 0,
  checks_failed integer not null default 0,
  warnings integer not null default 0,
  uploaded_by text,
  uploaded_at timestamptz not null default now()
);

create table if not exists forecast_upload_checks (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references forecast_uploads(id) on delete cascade,
  check_name text not null,
  expected numeric,
  reported numeric,
  diff numeric,
  passed boolean not null,
  blocking boolean not null default true
);

create index if not exists idx_forecast_uploads_company on forecast_uploads (company_id, uploaded_at desc);

alter table forecast_uploads enable row level security;
alter table forecast_upload_checks enable row level security;

create or replace function get_forecast_upload_log(p_company_id uuid, p_limit integer default 20)
returns table (
  file_name text, status text, months integer, categories integer,
  checks_passed integer, checks_failed integer, warnings integer,
  uploaded_by text, uploaded_at timestamptz
)
security definer
set search_path = public
language sql
as $$
  select file_name, status, months, categories, checks_passed, checks_failed, warnings, uploaded_by, uploaded_at
  from forecast_uploads
  where company_id = p_company_id
  order by uploaded_at desc
  limit least(greatest(p_limit, 1), 100);
$$;

revoke execute on function public.get_forecast_upload_log(uuid, integer) from public, anon;
grant execute on function public.get_forecast_upload_log(uuid, integer) to authenticated, service_role;
