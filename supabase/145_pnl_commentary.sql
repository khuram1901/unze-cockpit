-- Saved AI commentary for both P&L pages (18/07/2026). Khuram's feedback:
-- once the AI writes an analysis for a period+scope it should be SAVED and
-- shown on every return visit — regenerated only when someone presses
-- Regenerate. One row per (company, scope, period); regeneration upserts
-- over the old row.
--
--   company    'UTPL' or 'IFPL'
--   scope_key  UTPL: the plant filter ("All", "MEPCO", …)
--              IFPL: "<channel>|<branch>" ("All|All", "Online PK|All", …)
--
-- Writes go through /api/pnl/ceo-insights (service client). Reads via the
-- security-definer RPC so the pages can load the saved version directly.
-- RLS enabled, no policies. Apply manually via the Supabase SQL Editor.

create table if not exists pnl_commentary (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  scope_key text not null,
  month_from date not null,
  month_to date not null,
  insights jsonb not null,
  actions jsonb not null,
  generated_by text,
  generated_at timestamptz not null default now(),
  unique (company, scope_key, month_from, month_to)
);

alter table pnl_commentary enable row level security;

create or replace function get_pnl_commentary(p_company text, p_scope text, p_from date, p_to date)
returns table (insights jsonb, actions jsonb, generated_by text, generated_at timestamptz)
security definer
set search_path = public
language sql
as $$
  select insights, actions, generated_by, generated_at
  from pnl_commentary
  where company = p_company
    and scope_key = p_scope
    and month_from = p_from
    and month_to = p_to
  limit 1;
$$;
