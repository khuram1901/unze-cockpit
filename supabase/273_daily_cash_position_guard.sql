-- Migration 273: daily_cash_position guard trigger — 17/10/2026 (applied to production same day)
--
-- Root cause from the /finance/imperial audit: the 24/09/2026 IFPL cash sheet
-- was parsed as opening 0 / payments 0 / receipts 14,286,776 and accepted,
-- because the only check (opening + receipts - payments = closing) is
-- satisfied by that shape. Six different routes write daily_cash_position,
-- so the check now lives in one BEFORE trigger (golden rule: validation in
-- Postgres, every path covered):
--   1. arithmetic identity (±100 rounding)
--   2. opening must match the previous available day's closing (±100)
--   3. closing must match the next available day's opening (backdated uploads)
-- Rejections raise check_violation with a user-readable message starting
-- "Cash sheet rejected" — the API maps that to HTTP 422 (lib/cash-position-errors.ts).
--
-- Deliberate corrections (service role, SQL editor only — never set by the app):
--   select set_config('cash_position.skip_continuity', 'true', true);

begin;

create or replace function public.daily_cash_position_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_prev record;
  v_next record;
  v_eq numeric;
begin
  if coalesce(current_setting('cash_position.skip_continuity', true) = 'true', false) then
    return new;
  end if;
  v_eq := abs(coalesce(new.opening_balance,0) + coalesce(new.total_receipts,0) - coalesce(new.total_payments,0) - coalesce(new.closing_balance,0));
  if v_eq > 100 then
    raise exception 'Cash sheet rejected for %: opening (%) + receipts (%) - payments (%) does not equal closing (%) — out by %. Check the PDF and re-upload.',
      to_char(new.position_date,'DD/MM/YYYY'), new.opening_balance, new.total_receipts, new.total_payments, new.closing_balance, v_eq
      using errcode = 'check_violation';
  end if;
  select position_date, closing_balance into v_prev
  from daily_cash_position
  where company_id = new.company_id and position_date < new.position_date and id is distinct from new.id
  order by position_date desc limit 1;
  if found and abs(v_prev.closing_balance - new.opening_balance) > 100 then
    raise exception 'Cash sheet rejected for %: opening PKR % does not match % closing PKR % — out by PKR %. Check the PDF and re-upload.',
      to_char(new.position_date,'DD/MM/YYYY'), new.opening_balance, to_char(v_prev.position_date,'DD/MM/YYYY'), v_prev.closing_balance, abs(v_prev.closing_balance - new.opening_balance)
      using errcode = 'check_violation';
  end if;
  select position_date, opening_balance into v_next
  from daily_cash_position
  where company_id = new.company_id and position_date > new.position_date and id is distinct from new.id
  order by position_date asc limit 1;
  if found and abs(new.closing_balance - v_next.opening_balance) > 100 then
    raise exception 'Cash sheet rejected for %: closing PKR % does not match % opening PKR % — out by PKR %. Check the PDF and re-upload.',
      to_char(new.position_date,'DD/MM/YYYY'), new.closing_balance, to_char(v_next.position_date,'DD/MM/YYYY'), v_next.opening_balance, abs(new.closing_balance - v_next.opening_balance)
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger daily_cash_position_guard_trg
  before insert or update of opening_balance, total_receipts, total_payments, closing_balance, position_date
  on public.daily_cash_position for each row execute function public.daily_cash_position_guard();

commit;

-- Data fix applied the same day (not part of the migration):
--   IFPL 2026-09-24 daily_cash_position + cash_sheet_uploads corrected from the
--   stored PDF: opening -12,156,523 / receipts 15,320,269 / payments 14,286,776 /
--   closing -11,123,030 / PDC 150,486,854 / after PDC -161,609,884.

-- ─── ROLLBACK ────────────────────────────────────────────────────────────────
-- drop trigger if exists daily_cash_position_guard_trg on public.daily_cash_position;
-- drop function if exists public.daily_cash_position_guard();
