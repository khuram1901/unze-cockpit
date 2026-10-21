-- Migration 288: PDC Weekly Outlook — planned receivables support
--
-- Adds p_planned_monthly_receivables parameter to get_pdc_weekly_outlook.
-- If supplied (> 0), weekly receipts = planned_monthly / (days_in_month / 7.0).
-- If omitted (defaults to 0), falls back to trailing 4-week DB average.
-- This lets the Finance page pass PKR 240M for October instead of the trailing avg.
--
-- The running_balance calculation is unchanged; only the weekly receipts source changes.

CREATE OR REPLACE FUNCTION public.get_pdc_weekly_outlook(
  p_company_id                uuid,
  p_today                     date,
  p_planned_monthly_receivables numeric DEFAULT 0
)
RETURNS TABLE(
  week_number          integer,
  week_start           date,
  week_end             date,
  pdc_due              numeric,
  avg_weekly_receipts  numeric,
  running_balance      numeric,
  near_term            boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
  -- Latest daily cash position at or before today
  select max(position_date) into latest_date
  from daily_cash_position
  where company_id = p_company_id and position_date <= p_today;

  if latest_date is null then return; end if;

  select closing_balance into cash_in_hand
  from daily_cash_position
  where company_id = p_company_id and position_date = latest_date;

  -- Weekly receipts: use planned receivables if provided, else trailing 4-week avg
  if p_planned_monthly_receivables > 0 then
    -- days in the month of p_today
    days_in_month := EXTRACT(DAY FROM
      (date_trunc('month', p_today) + interval '1 month - 1 day')
    )::int;
    avg_receipts := p_planned_monthly_receivables / (days_in_month::numeric / 7.0);
  else
    -- Trailing 4-week average weekly receipts
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

  -- Snap to Monday of current week
  current_monday := p_today - ((EXTRACT(DOW FROM p_today)::int + 6) % 7);

  -- Find furthest PDC due date
  select max(due_date) into max_due
  from pdc_maturity_buckets
  where company_id = p_company_id and position_date = latest_date;

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

    running_bal         := running_bal + avg_receipts - due_this_week;
    week_number         := w;
    week_start          := ws;
    week_end            := we;
    pdc_due             := due_this_week;
    avg_weekly_receipts := avg_receipts;
    running_balance     := running_bal;
    near_term           := (w <= 6);
    return next;
  end loop;
end;
$function$;
