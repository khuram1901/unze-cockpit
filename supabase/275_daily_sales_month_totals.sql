-- Migration 275: Retail Sales month footer totals in Postgres — 17/10/2026 (applied same day)
-- The Retail Sales tab summed its footer row with JS reduce(), against the
-- DECISIONS rule "all calculations live in Supabase". SECURITY INVOKER so the
-- caller's RLS on daily_sales_computed (widget or own store) still applies.

begin;

create or replace function public.get_daily_sales_month_totals(p_store_id uuid, p_month_start date)
returns jsonb language sql stable security invoker set search_path = public as $$
  with r as (
    select * from daily_sales_computed
    where store_id = p_store_id
      and sales_date >= p_month_start
      and sales_date < (p_month_start + interval '1 month')::date
  )
  select jsonb_build_object(
    'row_count',              count(*),
    'cash_sale',              coalesce(sum(cash_sale),0),
    'campaign_float_cash',    coalesce(sum(campaign_float_cash),0),
    'expenses',               coalesce(sum(expenses),0),
    'other_income',           coalesce(sum(other_income),0),
    'deposit',                coalesce(sum(deposit),0),
    'allied_bank_cc_sale',    coalesce(sum(allied_bank_cc_sale),0),
    'hbl_cc_sale',            coalesce(sum(hbl_cc_sale),0),
    'gift_karte',             coalesce(sum(gift_karte),0),
    'gift_vouchers',          coalesce(sum(gift_vouchers),0),
    'credit_notes_issue',     coalesce(sum(credit_notes_issue),0),
    'total_credit_card_sale', coalesce(sum(total_credit_card_sale),0),
    'total_sale',             coalesce(sum(total_sale),0),
    'net_cash_movement',      coalesce(sum(net_cash_movement),0),
    'opening_balance',        (select opening_balance from r where opening_balance is not null order by sales_date asc  limit 1),
    'closing_balance',        (select closing_balance from r where closing_balance is not null order by sales_date desc limit 1)
  ) from r;
$$;
revoke execute on function public.get_daily_sales_month_totals(uuid, date) from anon, public;
grant execute on function public.get_daily_sales_month_totals(uuid, date) to authenticated;

commit;

-- ─── ROLLBACK ────────────────────────────────────────────────────────────────
-- drop function if exists public.get_daily_sales_month_totals(uuid, date);
