-- Migration 297: Fix get_pdc_outlook_v2 to use independent PDC date lookup
-- 05/11/2026
--
-- Bug: the RPC used max(position_date) from daily_cash_position as the date to
-- look up PDC rows in pdc_maturity_buckets. If the PDC was uploaded on a
-- different day from the latest cash sheet (e.g. uploaded with today's cash
-- flow while the most recent cash sheet is yesterday), all PDC queries returned
-- zero — the PDC outlook showed £0 for every week.
--
-- Fix: add a separate latest_pdc_date from pdc_maturity_buckets and use it for
-- all PDC queries, independent of the cash sheet date.

CREATE OR REPLACE FUNCTION public.get_pdc_outlook_v2(p_company_id uuid, p_today date, p_planned_monthly_receivables numeric DEFAULT 0)
 RETURNS TABLE(week_number integer, week_start date, week_end date, pdc_due numeric, avg_weekly_receipts numeric, running_balance numeric, near_term boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  latest_date      date;   -- latest cash sheet date (for cash-in-hand)
  latest_pdc_date  date;   -- latest PDC upload date (independent of cash sheet date)
  cash_in_hand     numeric;
  avg_receipts     numeric;
  running_bal      numeric;
  current_monday   date;
  max_due          date;
  weeks_needed     int;
  w                int;
  ws               date;
  we               date;
  due_this_week    numeric;
  days_in_month    int;
begin
  -- Latest cash sheet (for opening balance / cash-in-hand)
  select max(position_date) into latest_date
  from daily_cash_position
  where company_id = p_company_id and position_date <= p_today;

  if latest_date is null then return; end if;

  select closing_balance into cash_in_hand
  from daily_cash_position
  where company_id = p_company_id and position_date = latest_date;

  -- Latest PDC upload (independent — PDC may be uploaded on a different day
  -- than the cash sheet, e.g. uploaded with today's cash flow PDF while the
  -- most recent cash sheet date is yesterday).
  select max(position_date) into latest_pdc_date
  from pdc_maturity_buckets
  where company_id = p_company_id and position_date <= p_today;

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

  -- Find the furthest PDC due-date using latest_pdc_date (not latest_date)
  select max(due_date) into max_due
  from pdc_maturity_buckets
  where company_id = p_company_id and position_date = latest_pdc_date;

  weeks_needed := LEAST(20, GREATEST(8,
    CEIL((COALESCE(max_due, p_today) - current_monday)::numeric / 7) + 1
  ));

  running_bal := cash_in_hand;

  for w in 1..weeks_needed loop
    ws := current_monday + ((w - 1) * 7);
    we := ws + 6;

    -- Use latest_pdc_date for PDC lookups (not latest_date)
    select coalesce(sum(amount), 0) into due_this_week
    from pdc_maturity_buckets
    where company_id = p_company_id
      and position_date = latest_pdc_date
      and due_date >= ws
      and due_date <= we;

    running_bal         := running_bal + avg_receipts - due_this_week;
    week_number         := w;
    week_start          := ws;
    week_end            := we;
    pdc_due             := due_this_week;
    avg_weekly_receipts := avg_receipts;
    running_balance     := running_bal;
    near_term           := (w <= 8);
    return next;
  end loop;
end;
$function$;
