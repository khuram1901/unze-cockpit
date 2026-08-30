-- Phase 4 (tech debt, rule 0): the restatement-detection blocks in the three
-- P&L upload routes summed STORED rows in JS (oldMap loops). These RPCs
-- return the stored sums pre-grouped; the routes keep only the payload-side
-- sums and the diff (payload transformation, allowed to stay in JS).

-- IFPL retail (upload-ifpl): stored actuals per branch for given lines.
create or replace function public.get_ifpl_pnl_line_sums(
  p_month date,
  p_lines text[]
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(t), '[]'::jsonb) from (
    select branch as scope, line, sum(actual)::numeric as total
    from ifpl_pnl_lines
    where month = p_month and line = any(p_lines)
    group by branch, line
  ) t;
$$;

-- Restaurants (upload-restaurants): stored amounts per branch for a company.
create or replace function public.get_rest_pnl_line_sums(
  p_company text,
  p_month date,
  p_lines text[]
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(t), '[]'::jsonb) from (
    select branch as scope, line, sum(amount)::numeric as total
    from rest_pnl_lines
    where company = p_company and month = p_month and line = any(p_lines)
    group by branch, line
  ) t;
$$;

-- UTPL (upload-unze): stored amounts per plant for a company id.
create or replace function public.get_utpl_pnl_line_sums(
  p_company_id uuid,
  p_month date,
  p_lines text[]
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(t), '[]'::jsonb) from (
    select plant as scope, line, sum(amount)::numeric as total
    from pnl_line_items
    where company_id = p_company_id and month = p_month and line = any(p_lines)
    group by plant, line
  ) t;
$$;
