-- ============================================================
-- 073: Update get_pension_fund_breakdown() to include factsheet fields
-- New columns assumed already added to pension_funds table:
--   risk_rating, ongoing_charge_pct, benchmark,
--   return_1m_pct, return_3m_pct, return_6m_pct,
--   return_1y_pct, return_5y_pct, return_since_inception_pct,
--   fund_size_gbp, factsheet_date, factsheet_notes
-- ============================================================

create or replace function get_pension_fund_breakdown()
returns table (
  fund_name              text,
  isin                   text,
  units_held             numeric,
  price_gbp              numeric,
  value_gbp              numeric,
  allocation_pct         numeric,
  price_date             date,
  risk_rating            integer,
  ongoing_charge_pct     numeric,
  benchmark              text,
  return_1m_pct          numeric,
  return_3m_pct          numeric,
  return_6m_pct          numeric,
  return_1y_pct          numeric,
  return_5y_pct          numeric,
  factsheet_date         date,
  factsheet_notes        text
)
language sql
security definer
set search_path = public
as $$
  with total as (
    select sum(ph.price * pf.units_held) as total_value
    from pension_funds pf
    join (
      select distinct on (isin)
        isin, price, price_date
      from pension_price_history
      order by isin, price_date desc
    ) ph on ph.isin = pf.isin
    where pf.is_active = true
  )
  select
    pf.fund_name,
    pf.isin,
    pf.units_held,
    ph.price                                              as price_gbp,
    ph.price * pf.units_held                              as value_gbp,
    case when t.total_value > 0
      then (ph.price * pf.units_held) / t.total_value * 100
      else 0
    end                                                   as allocation_pct,
    ph.price_date,
    pf.risk_rating,
    pf.ongoing_charge_pct,
    pf.benchmark,
    pf.return_1m_pct,
    pf.return_3m_pct,
    pf.return_6m_pct,
    pf.return_1y_pct,
    pf.return_5y_pct,
    pf.factsheet_date,
    pf.factsheet_notes
  from pension_funds pf
  join (
    select distinct on (isin)
      isin, price, price_date
    from pension_price_history
    order by isin, price_date desc
  ) ph on ph.isin = pf.isin
  cross join total t
  where pf.is_active = true
  order by value_gbp desc;
$$;
