-- Catch-up migration: tax_accounts_signoffs table
-- This table was created ad hoc in the Supabase SQL editor and was missing
-- from the migration record. Adding it here so the schema is reproducible.
-- Safe to run on a database where the table already exists (all statements
-- use IF NOT EXISTS / IF EXISTS guards).

create table if not exists public.tax_accounts_signoffs (
  id              uuid primary key default gen_random_uuid(),
  tax_year        text        not null,
  section         text        not null,
  entity_key      text        not null,
  signed_off      boolean     not null default false,
  signed_off_by   text,
  signed_off_at   timestamptz,
  created_at      timestamptz not null default now(),
  unique (tax_year, section, entity_key)
);

-- Index for the most common query pattern: filter by tax_year
create index if not exists idx_tax_accounts_signoffs_year
  on public.tax_accounts_signoffs (tax_year);

-- Enable RLS (no-op if already enabled)
alter table public.tax_accounts_signoffs enable row level security;

-- RLS policies (mirror of what migration 124 applied — idempotent)
drop policy if exists tax_accounts_signoffs_select on public.tax_accounts_signoffs;
create policy tax_accounts_signoffs_select
  on public.tax_accounts_signoffs for select
  using (not (select is_pa()));

drop policy if exists tax_accounts_signoffs_write on public.tax_accounts_signoffs;
create policy tax_accounts_signoffs_write
  on public.tax_accounts_signoffs for insert
  with check (lower((select auth.email())) = 'shakeel@unze.co.uk' or is_admin_tier());

drop policy if exists tax_accounts_signoffs_update on public.tax_accounts_signoffs;
create policy tax_accounts_signoffs_update
  on public.tax_accounts_signoffs for update
  using (lower((select auth.email())) = 'shakeel@unze.co.uk' or is_admin_tier());

drop policy if exists tax_accounts_signoffs_delete on public.tax_accounts_signoffs;
create policy tax_accounts_signoffs_delete
  on public.tax_accounts_signoffs for delete
  using (lower((select auth.email())) = 'shakeel@unze.co.uk' or is_admin_tier());
