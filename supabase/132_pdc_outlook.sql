-- 132: PDC Outlook (15 Jul 2026, Khuram's request).
--
-- Khuram's correction to how "Net Position" worked: cash in hand and PDC
-- (post-dated cheques already issued) are two different things. A PDC
-- isn't out of his hand yet, so it must never be silently subtracted from
-- the headline cash figure -- it should be shown as its own line, and the
-- only place it should reduce a balance is in a genuine forward-looking
-- projection ("if these cheques clear on schedule, here's what's left").
--
-- Both companies' daily cash-flow PDFs report PDCs as one or more dated
-- buckets ("Balance 31/07/2026  57,017,823", "Total Balance 01/11/2026
-- 5,634,800" for Imperial; one line per cheque with its own date for Unze)
-- rather than a single lump sum -- this table stores each bucket from each
-- day's report so we can build a genuine week-by-week outlook instead of
-- guessing. Old snapshots are kept (not overwritten) so this also becomes
-- a history of what was outstanding on any given day; the RPC below always
-- reads only the latest report per company.
--
-- Apply manually via the Supabase SQL Editor, per project convention.

create table if not exists pdc_maturity_buckets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  position_date date not null,       -- the day this cash-flow report was for
  due_date date not null,            -- when this bucket of PDCs matures/clears
  amount numeric not null,
  label text,                        -- optional: payee name (Unze) or "Balance"/"Total Balance" (Imperial)
  created_at timestamptz not null default now()
);

create index if not exists idx_pdc_buckets_company_position on pdc_maturity_buckets(company_id, position_date);

alter table pdc_maturity_buckets enable row level security;

create policy "pdc_buckets_read" on pdc_maturity_buckets for select to authenticated using (true);
-- Writes only ever happen server-side via the service-role client in the
-- ingestion routes (check-inbox / parse-cash-flow), same as daily_cash_position
-- and bank_position_snapshots -- no direct client write policy needed.

create or replace function get_pdc_outlook(p_company_id uuid, p_today date)
returns table (
  week_number int,
  week_start date,
  week_end date,
  pdc_due numeric,
  effective_balance numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  latest_date date;
  cash_in_hand numeric;
  running_balance numeric;
  w int;
  ws date;
  we date;
  due_this_week numeric;
begin
  select max(position_date) into latest_date
  from daily_cash_position
  where company_id = p_company_id and position_date <= p_today;

  if latest_date is null then
    return;
  end if;

  select closing_balance into cash_in_hand
  from daily_cash_position
  where company_id = p_company_id and position_date = latest_date;

  running_balance := cash_in_hand;

  for w in 1..8 loop
    ws := p_today + (w - 1) * 7;
    we := ws + 6;

    select coalesce(sum(amount), 0) into due_this_week
    from pdc_maturity_buckets
    where company_id = p_company_id
      and position_date = latest_date
      and due_date >= ws and due_date <= we;

    running_balance := running_balance - due_this_week;

    week_number := w;
    week_start := ws;
    week_end := we;
    pdc_due := due_this_week;
    effective_balance := running_balance;
    return next;
  end loop;
end;
$$;

grant execute on function get_pdc_outlook(uuid, date) to authenticated;
