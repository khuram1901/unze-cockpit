-- Restatement log (28/07/2026) — Khuram's transparency requirement: "if any
-- figures are changed in previous months, it must bring it to our attention
-- … so we see if the teams are changing numbers."
--
-- Whenever an upload REPLACES a month that already exists, the upload route
-- compares the stored key figures (net sales + net profit, per branch or
-- plant) against the incoming ones BEFORE overwriting, and records every
-- change here permanently: what changed, from what to what, who uploaded,
-- when. Applies to all three pipelines (company: 'UTPL' | 'IFPL' |
-- 'BARANH' | 'HD'). The rows are append-only — nothing in the app ever
-- deletes them.
--
-- RLS enabled, no policies (writes via service role, reads via the
-- definer RPC, anon revoked per the 149 pattern). Apply manually via the
-- Supabase SQL Editor.

create table if not exists pnl_restatements (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  month date not null,
  scope text not null,          -- branch / plant name, or 'Company'
  line text not null,           -- e.g. 'Net Sales', 'Net Profit'
  old_value numeric not null,
  new_value numeric not null,
  changed_by text,
  changed_at timestamptz not null default now()
);

create index if not exists idx_pnl_restatements_company on pnl_restatements (company, changed_at desc);

alter table pnl_restatements enable row level security;

create or replace function get_pnl_restatements(p_company text, p_limit integer default 100)
returns table (
  month date, scope text, line text,
  old_value numeric, new_value numeric,
  changed_by text, changed_at timestamptz
)
security definer
set search_path = public
language sql
as $$
  select month, scope, line, old_value, new_value, changed_by, changed_at
  from pnl_restatements
  where company = p_company
  order by changed_at desc, month desc
  limit least(greatest(p_limit, 1), 500);
$$;

revoke execute on function public.get_pnl_restatements(text, integer) from public, anon;
grant execute on function public.get_pnl_restatements(text, integer) to authenticated, service_role;
