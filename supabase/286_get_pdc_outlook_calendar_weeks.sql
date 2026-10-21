-- Migration 286: PDC Outlook — calendar-week alignment + dynamic window
--
-- Two fixes in one:
-- 1. Weeks now start on Monday (ISO calendar week), not rolling from today.
--    Both of IFPL's PDC due dates fall on weekends (Oct 31 = Sat, Jan 31 = Sun);
--    the old rolling window from today could land mid-week and miss them.
-- 2. Window extends to cover ALL outstanding PDC buckets (min 4, max 20 weeks)
--    instead of a hard-coded 8 — previously hid IFPL's 128.7M "Total Balance"
--    catch-all dated Jan 31, 2027 (week 15 from the current Monday).

CREATE OR REPLACE FUNCTION public.get_pdc_outlook(p_company_id uuid, p_today date)
RETURNS TABLE(week_number integer, week_start date, week_end date, pdc_due numeric, effective_balance numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  latest_date     date;
  cash_in_hand    numeric;
  running_balance numeric;
  current_monday  date;
  max_due         date;
  weeks_needed    int;
  w               int;
  ws              date;
  we              date;
  due_this_week   numeric;
begin
  select max(position_date) into latest_date
  from daily_cash_position
  where company_id = p_company_id and position_date <= p_today;

  if latest_date is null then return; end if;

  select closing_balance into cash_in_hand
  from daily_cash_position
  where company_id = p_company_id and position_date = latest_date;

  -- Snap back to Monday of the current week.
  -- EXTRACT(DOW): 0=Sun, 1=Mon … 6=Sat.  (DOW+6)%7 = days since Monday.
  current_monday := p_today - ((EXTRACT(DOW FROM p_today)::int + 6) % 7);

  -- Find furthest PDC due date so we know how many weeks to show.
  select max(due_date) into max_due
  from pdc_maturity_buckets
  where company_id = p_company_id and position_date = latest_date;

  -- At least 4 weeks, at most 20, always covering one week past the last bucket.
  weeks_needed := LEAST(20, GREATEST(4,
    CEIL((COALESCE(max_due, p_today) - current_monday)::numeric / 7) + 1
  ));

  running_balance := cash_in_hand;

  for w in 1..weeks_needed loop
    ws := current_monday + ((w - 1) * 7);   -- Monday
    we := ws + 6;                             -- Sunday (Mon–Sun keeps no gaps for weekend-dated cheques)

    select coalesce(sum(amount), 0) into due_this_week
    from pdc_maturity_buckets
    where company_id = p_company_id
      and position_date = latest_date
      and due_date >= ws
      and due_date <= we;

    running_balance   := running_balance - due_this_week;
    week_number       := w;
    week_start        := ws;
    week_end          := we;
    pdc_due           := due_this_week;
    effective_balance := running_balance;
    return next;
  end loop;
end;
$function$;
