-- Migration 287: PDC Weekly Outlook — adds avg_weekly_receipts and running_balance
--
-- Extends the PDC outlook with:
-- 1. avg_weekly_receipts: trailing 4-week average of total_receipts from daily_cash_position
--    (summed per ISO week, then averaged — so it's a true weekly estimate)
-- 2. running_balance: cumulative balance accounting for BOTH receipts AND PDC outflows
--    starting from cash in hand.  This replaces effective_balance (receipts-blind) for
--    the new week-by-week card UI.
-- 3. near_term flag: TRUE for the first 6 weeks, FALSE for weeks beyond that
--    (used by the UI to split "next 6 weeks" vs "future commitments").
--
-- The original get_pdc_outlook() is kept for backward compatibility.
-- New UI calls get_pdc_weekly_outlook() instead.

CREATE OR REPLACE FUNCTION public.get_pdc_weekly_outlook(p_company_id uuid, p_today date)
RETURNS TABLE(
  week_number        integer,
  week_start         date,
  week_end           date,
  pdc_due            numeric,
  avg_weekly_receipts numeric,
  running_balance    numeric,
  near_term          boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  latest_date        date;
  cash_in_hand       numeric;
  avg_receipts       numeric;
  running_bal        numeric;
  current_monday     date;
  max_due            date;
  weeks_needed       int;
  w                  int;
  ws                 date;
  we                 date;
  due_this_week      numeric;
begin
  -- Latest daily cash position at or before today
  select max(position_date) into latest_date
  from daily_cash_position
  where company_id = p_company_id and position_date <= p_today;

  if latest_date is null then return; end if;

  select closing_balance into cash_in_hand
  from daily_cash_position
  where company_id = p_company_id and position_date = latest_date;

  -- Trailing 4-week average weekly receipts.
  -- Sum total_receipts by ISO week for the 4 calendar weeks ending at latest_date's week,
  -- then divide by 4.  Using date arithmetic rather than date_trunc for compatibility.
  select coalesce(
    sum(total_receipts) / nullif(count(distinct
      -- week bucket: Monday of each row's week
      (position_date - ((EXTRACT(DOW FROM position_date)::int + 6) % 7))
    ), 0),
    0
  ) into avg_receipts
  from daily_cash_position
  where company_id = p_company_id
    and position_date <= latest_date
    and position_date > latest_date - 28;  -- 4 weeks back

  -- Snap back to Monday of the current week
  current_monday := p_today - ((EXTRACT(DOW FROM p_today)::int + 6) % 7);

  -- Find furthest PDC due date
  select max(due_date) into max_due
  from pdc_maturity_buckets
  where company_id = p_company_id and position_date = latest_date;

  -- At least 6 weeks (near-term window), at most 20, covering one week past last bucket
  weeks_needed := LEAST(20, GREATEST(6,
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

    running_bal     := running_bal + avg_receipts - due_this_week;
    week_number     := w;
    week_start      := ws;
    week_end        := we;
    pdc_due         := due_this_week;
    avg_weekly_receipts := avg_receipts;
    running_balance := running_bal;
    near_term       := (w <= 6);
    return next;
  end loop;
end;
$function$;
