-- Migration 296: PDC Outlook 8-week window + month-specific PDC total
--
-- Changes:
--   A) get_pdc_outlook_v2 — extend near_term boundary from 6 → 8 weeks
--      (also bumps GREATEST(6,...) → GREATEST(8,...) so minimum is 8 weeks)
--   B) get_pdc_month_total — new RPC returning sum of PDCs due in a given
--      calendar month, filtered to the latest available cash sheet.
--
-- Applied manually: paste into Supabase SQL Editor, run once.

-- ─────────────────────────────────────────────────────────────────────────────
-- A) Update get_pdc_outlook_v2: 6 weeks → 8 weeks
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_pdc_outlook_v2(
  p_company_id                 uuid,
  p_today                      date,
  p_planned_monthly_receivables numeric DEFAULT 0
)
RETURNS TABLE(
  week_number         integer,
  week_start          date,
  week_end            date,
  pdc_due             numeric,
  avg_weekly_receipts numeric,
  running_balance     numeric,
  near_term           boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  latest_date   date;
  cash_in_hand  numeric;
  avg_receipts  numeric;
  running_bal   numeric;
  current_monday date;
  max_due       date;
  weeks_needed  int;
  w             int;
  ws            date;
  we            date;
  due_this_week numeric;
  days_in_month int;
begin
  select max(position_date) into latest_date
  from daily_cash_position
  where company_id = p_company_id and position_date <= p_today;

  if latest_date is null then return; end if;

  select closing_balance into cash_in_hand
  from daily_cash_position
  where company_id = p_company_id and position_date = latest_date;

  if p_planned_monthly_receivables > 0 then
    days_in_month := EXTRACT(DAY FROM
      (date_trunc('month', p_today) + interval '1 month - 1 day')
    )::int;
    avg_receipts := p_planned_monthly_receivables / (days_in_month::numeric / 7.0);
  else
    select coalesce(
      sum(total_receipts) / nullif(count(distinct
        (position_date - ((EXTRACT(DOW FROM position_date)::int + 6) % 7))
      ), 0),
      0
    ) into avg_receipts
    from daily_cash_position
    where company_id = p_company_id
      and position_date <= latest_date
      and position_date > latest_date - 28;
  end if;

  current_monday := p_today - ((EXTRACT(DOW FROM p_today)::int + 6) % 7);

  select max(due_date) into max_due
  from pdc_maturity_buckets
  where company_id = p_company_id and position_date = latest_date;

  -- Changed: GREATEST(6, ...) → GREATEST(8, ...) to guarantee minimum 8 weeks
  weeks_needed := LEAST(20, GREATEST(8,
    CEIL((COALESCE(max_due, p_today) - current_monday)::numeric / 7) + 1
  ));

  running_bal := cash_in_hand;

  for w in 1..weeks_needed loop
    ws := current_monday + ((w - 1) * 7);
    we := ws + 6;

    select coalesce(sum(amount), 0) into due_this_week
    from pdc_maturity_buckets
    where company_id = p_company_id
      and position_date = latest_date
      and due_date >= ws
      and due_date <= we;

    running_bal         := running_bal + avg_receipts - due_this_week;
    week_number         := w;
    week_start          := ws;
    week_end            := we;
    pdc_due             := due_this_week;
    avg_weekly_receipts := avg_receipts;
    running_balance     := running_bal;
    near_term           := (w <= 8);  -- Changed: 6 → 8
    return next;
  end loop;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- B) New: get_pdc_month_total
--    Returns the sum of PDC amounts due within a calendar month, using the
--    most recent cash sheet on or before p_as_of.
--    Used by the "PDC Outstanding" summary card to show dues this month only.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_pdc_month_total(
  p_company_id uuid,
  p_month      date,
  p_as_of      date DEFAULT CURRENT_DATE
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(SUM(b.amount), 0)
  FROM pdc_maturity_buckets b
  WHERE b.company_id = p_company_id
    AND b.position_date = (
      SELECT MAX(d.position_date)
      FROM daily_cash_position d
      WHERE d.company_id = p_company_id
        AND d.position_date <= p_as_of
    )
    AND b.due_date >= date_trunc('month', p_month)::date
    AND b.due_date <  (date_trunc('month', p_month) + interval '1 month')::date;
$$;

-- Revoke anon access (defence-in-depth — RLS on underlying tables already blocks it)
REVOKE EXECUTE ON FUNCTION public.get_pdc_month_total(uuid, date, date) FROM anon;
