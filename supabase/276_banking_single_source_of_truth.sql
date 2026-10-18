-- Migration 276: Banking cash sheets — one source of truth — 18/10/2026 (applied same day)
--
-- Findings from the /banking audit:
--   • cash_sheet_uploads (Banking's copy) and daily_cash_position (what every
--     finance page shows) were written separately and had drifted on 11 days;
--     59 sheets had lines but zero/null totals; Banking's continuity alerts
--     disagreed with Finance's.
--   • admin_eobi_payments was readable by every signed-in user (RLS SELECT true).
--   • The Banking page summed receipt/payment lines in JS.
--
-- Decision (Khuram, 18/10/2026): daily_cash_position — validated by the guard
-- trigger from migration 273 — is the source of truth for the day's figures.
-- Banking's copy is kept in step by trigger; Banking's continuity reads the
-- same function as Finance.

begin;

-- 1. Mirror validated position totals into the Banking copy
create or replace function public.cash_sheet_uploads_mirror_from_position()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  select short_code into v_code from companies where id = new.company_id;
  if v_code is null then return new; end if;
  update cash_sheet_uploads u
     set opening_balance_pkr = new.opening_balance, closing_balance_pkr = new.closing_balance,
         receipts_pkr = new.total_receipts, payments_pkr = new.total_payments
   where u.company = v_code and u.sheet_date = new.position_date
     and (u.opening_balance_pkr is distinct from new.opening_balance or u.closing_balance_pkr is distinct from new.closing_balance
       or u.receipts_pkr is distinct from new.total_receipts or u.payments_pkr is distinct from new.total_payments);
  return new;
end; $$;
create trigger cash_sheet_uploads_mirror_trg
  after insert or update of opening_balance, total_receipts, total_payments, closing_balance
  on public.daily_cash_position for each row execute function public.cash_sheet_uploads_mirror_from_position();

-- 2. One-off reconcile (ran 18/10/2026): Banking copy := validated position for every day that has both
update cash_sheet_uploads u
   set opening_balance_pkr = p.opening_balance, closing_balance_pkr = p.closing_balance,
       receipts_pkr = p.total_receipts, payments_pkr = p.total_payments
  from daily_cash_position p join companies c on c.id = p.company_id
 where u.company = c.short_code and u.sheet_date = p.position_date
   and (u.opening_balance_pkr is distinct from p.opening_balance or u.closing_balance_pkr is distinct from p.closing_balance
     or u.receipts_pkr is distinct from p.total_receipts or u.payments_pkr is distinct from p.total_payments);

-- 3. Banking continuity = Finance continuity (same source, same ±100 tolerance)
create or replace function public.cash_sheet_continuity(p_company text)
returns table(prev_date date, prev_closing numeric, next_date date, next_opening numeric, difference numeric)
language sql security definer set search_path = public as $$
  select b.prev_date, b.prev_closing, b.next_date, b.next_opening, b.difference
  from companies c, lateral daily_cash_continuity(c.id) b
  where c.short_code = p_company order by b.next_date desc;
$$;

-- 4. EOBI payments: direct reads only for admin tier / banking / admin-ops users
alter policy auth_read on public.admin_eobi_payments
  using (is_admin_tier() or coalesce(perm_override('can_access_banking'), false) or coalesce(perm_override('can_access_admin_ops'), false));

-- 5. Line sums and counts in the database (Banking list + detail)
create or replace view public.cash_sheet_uploads_with_totals as
  select u.*,
    coalesce((select sum(t.amount_pkr) from cash_sheet_transactions t where t.sheet_id = u.id and t.txn_type = 'receipt'), 0) as line_receipts_pkr,
    coalesce((select sum(t.amount_pkr) from cash_sheet_transactions t where t.sheet_id = u.id and t.txn_type = 'payment'), 0) as line_payments_pkr,
    (select count(*) from cash_sheet_transactions t where t.sheet_id = u.id and t.txn_type = 'receipt') as receipt_count,
    (select count(*) from cash_sheet_transactions t where t.sheet_id = u.id and t.txn_type = 'payment') as payment_count
  from cash_sheet_uploads u;
revoke all on public.cash_sheet_uploads_with_totals from anon, authenticated;

commit;

-- Housekeeping: get_eobi_payment_summary(integer) was created during the session and is
-- unused (page badges are per-entity-group over the already-aggregated calendar).
-- Safe to: drop function if exists public.get_eobi_payment_summary(integer);

-- ─── ROLLBACK ────────────────────────────────────────────────────────────────
-- begin;
-- drop view if exists public.cash_sheet_uploads_with_totals;
-- alter policy auth_read on public.admin_eobi_payments using (true);
-- -- cash_sheet_continuity(): restore the lag()-over-cash_sheet_uploads body from migration history
-- drop trigger if exists cash_sheet_uploads_mirror_trg on public.daily_cash_position;
-- drop function if exists public.cash_sheet_uploads_mirror_from_position();
-- -- (reconciled totals are not reverted — they match the validated positions)
-- commit;
