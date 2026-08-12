-- Migration 207: Cash sheet continuity audit
-- Rule: the previous day's CLOSING balance must equal the next day's OPENING
-- balance. A break means the file is corrupted or a figure was entered wrong.
--
-- Two functions, one per data source:
--   daily_cash_continuity(p_company_id)  → daily_cash_position (Unze Trading / Imperial finance pages)
--   cash_sheet_continuity(p_company)     → cash_sheet_uploads  (Restaurants daily page: BRNH / HD / KKJ)
--
-- Each returns every consecutive pair of entries (by date, whole history —
-- weekends/gaps included, because Friday's closing must still equal Monday's
-- opening) where the figures differ by more than 1 rupee.

-- ── Daily cash position (UTPL / IFPL) ────────────────────────────────────────

create or replace function daily_cash_continuity(p_company_id uuid)
returns table (
  prev_date    date,
  prev_closing numeric,
  next_date    date,
  next_opening numeric,
  difference   numeric
)
language sql
security definer
set search_path = public
as $$
  with ordered as (
    select
      position_date,
      opening_balance,
      closing_balance,
      lag(position_date)    over (order by position_date) as p_date,
      lag(closing_balance)  over (order by position_date) as p_closing
    from daily_cash_position
    where company_id = p_company_id
  )
  select
    p_date            as prev_date,
    p_closing         as prev_closing,
    position_date     as next_date,
    opening_balance   as next_opening,
    opening_balance - p_closing as difference
  from ordered
  where p_date is not null
    and p_closing is not null
    and opening_balance is not null
    and abs(opening_balance - p_closing) > 1
  order by position_date desc;
$$;

-- ── Cash sheet uploads (BRNH / HD / KKJ — also works for UTPL / IFPL) ────────

create or replace function cash_sheet_continuity(p_company text)
returns table (
  prev_date    date,
  prev_closing numeric,
  next_date    date,
  next_opening numeric,
  difference   numeric
)
language sql
security definer
set search_path = public
as $$
  with ordered as (
    select
      sheet_date,
      opening_balance_pkr,
      closing_balance_pkr,
      lag(sheet_date)          over (order by sheet_date) as p_date,
      lag(closing_balance_pkr) over (order by sheet_date) as p_closing
    from cash_sheet_uploads
    where company = p_company
  )
  select
    p_date               as prev_date,
    p_closing            as prev_closing,
    sheet_date           as next_date,
    opening_balance_pkr  as next_opening,
    opening_balance_pkr - p_closing as difference
  from ordered
  where p_date is not null
    and p_closing is not null
    and opening_balance_pkr is not null
    and abs(opening_balance_pkr - p_closing) > 1
  order by sheet_date desc;
$$;

-- ── Lock down (migration 149/202 pattern) ────────────────────────────────────

revoke execute on function daily_cash_continuity(uuid) from public, anon;
revoke execute on function cash_sheet_continuity(text) from public, anon;
grant execute on function daily_cash_continuity(uuid) to authenticated, service_role;
grant execute on function cash_sheet_continuity(text) to authenticated, service_role;
