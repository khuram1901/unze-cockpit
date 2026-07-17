-- P&L upload + storage schema (Phase 1: Unze Trading only).
-- Apply manually via the Supabase SQL Editor — do not auto-run.
--
-- Mirrors the shape of Unze Trading's existing Excel dashboard:
--   pnl_line_items    ~= "SData" (per-plant summary lines: Gross Sale, GP, etc.)
--   pnl_ledger_lines   ~= "AData" (per-plant, per-account-group/code ledger detail)
--   pnl_allocation_pct ~= "LData" (HO overhead allocation % per plant per month)
-- pnl_uploads is the audit trail of every upload attempt, accepted or rejected.
-- pnl_validation_checks records every individual check run against an upload,
-- so a rejected file's exact reasons are preserved, not just a pass/fail flag.

create table if not exists pnl_uploads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  month date not null,                    -- first of month, e.g. 2026-05-01
  file_name text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  uploaded_by text not null,               -- member email
  uploaded_at timestamptz not null default now(),
  checks_passed int not null default 0,
  checks_failed int not null default 0,
  rejection_summary text,                  -- plain-language reason, shown to the uploader
  unique (company_id, month, status) deferrable initially deferred
);

create table if not exists pnl_line_items (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references pnl_uploads(id) on delete cascade,
  company_id uuid not null references companies(id),
  month date not null,
  plant text not null,                     -- FEDMIC / MEPCO / PESCO / HO / Total
  line text not null,                      -- Gross Sale / Total Cost of Sale / GP / ...
  amount numeric not null
);
create index if not exists idx_pnl_line_items_lookup on pnl_line_items (company_id, month, plant, line);

create table if not exists pnl_ledger_lines (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references pnl_uploads(id) on delete cascade,
  company_id uuid not null references companies(id),
  month date not null,
  plant text not null,
  account_group text not null,             -- Payroll / Admin-Utility / Cost of Finished Goods / ...
  account_code text,                       -- e.g. C-51110001, nullable — some rows are group subtotals
  account_name text,
  amount numeric not null
);
create index if not exists idx_pnl_ledger_lines_lookup on pnl_ledger_lines (company_id, month, plant, account_group);

create table if not exists pnl_allocation_pct (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references pnl_uploads(id) on delete cascade,
  company_id uuid not null references companies(id),
  month date not null,
  plant text not null,                     -- FEDMIC / MEPCO / PESCO (HO allocates out, never allocated to)
  pct numeric not null
);

create table if not exists pnl_validation_checks (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references pnl_uploads(id) on delete cascade,
  check_name text not null,                -- e.g. "Plants sum vs file total — Gross Sale"
  expected numeric,
  reported numeric,
  diff numeric,
  passed boolean not null,
  detail text
);

-- Row Level Security: read access follows the same finance_company_scope
-- pattern as the rest of Finance (see app/lib/permissions.ts financeCompanies()).
-- Actual enforcement happens in the API route (requireAuth + financeCompanies
-- check) since these RPCs are security definer; RLS below is a defence-in-depth
-- backstop, not the primary gate.
alter table pnl_uploads enable row level security;
alter table pnl_line_items enable row level security;
alter table pnl_ledger_lines enable row level security;
alter table pnl_allocation_pct enable row level security;
alter table pnl_validation_checks enable row level security;

drop policy if exists pnl_uploads_service_only on pnl_uploads;
create policy pnl_uploads_service_only on pnl_uploads for all using (false);
drop policy if exists pnl_line_items_service_only on pnl_line_items;
create policy pnl_line_items_service_only on pnl_line_items for all using (false);
drop policy if exists pnl_ledger_lines_service_only on pnl_ledger_lines;
create policy pnl_ledger_lines_service_only on pnl_ledger_lines for all using (false);
drop policy if exists pnl_allocation_pct_service_only on pnl_allocation_pct;
create policy pnl_allocation_pct_service_only on pnl_allocation_pct for all using (false);
drop policy if exists pnl_validation_checks_service_only on pnl_validation_checks;
create policy pnl_validation_checks_service_only on pnl_validation_checks for all using (false);
-- "for all using (false)" blocks the anon/authenticated roles entirely;
-- all reads/writes go through createServiceClient() in the API routes,
-- which bypasses RLS, exactly like every other finance table in this app.
