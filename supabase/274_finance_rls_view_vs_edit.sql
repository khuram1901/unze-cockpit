-- Migration 274: finance tables — separate view from edit, fix company-scope check — 17/10/2026
-- Applied to production same day.
--
-- Findings from the /finance/imperial audit:
--   1. cash_opening_balance / monthly_cash_plan / monthly_budgets / daily_cash_position
--      each had one ALL policy = can_see_company_finance(), so anyone who could
--      VIEW finance could also write these tables directly through the Supabase
--      client (the UI only hid the buttons). Writes now require
--      can_edit_company_finance(), which mirrors canEditFinance() in the app.
--   2. can_see_company_finance() compared the target company to members.company
--      (usually "Unze Group") instead of to the finance_company_scope value, so a
--      scoped viewer such as Abbasi (scope IFPL) saw 0 rows on /finance/imperial.
--   3. PA (Executive role) is now refused explicitly, matching the app rule.
--
-- Policies are altered in place (USING = view, WITH CHECK = edit) plus one
-- RESTRICTIVE DELETE policy per table, because WITH CHECK does not apply to DELETE.

begin;

create or replace function public.can_see_company_finance(target_company uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare ov boolean; scope text; my_co uuid;
begin
  if exists (select 1 from members where email = auth.email() and role = 'Executive') then return false; end if;
  ov := perm_override('can_view_finance');
  if ov is not null then
    if ov = false then return false; end if;
    if target_company is null or is_admin_tier() then return true; end if;
    select finance_company_scope into scope from member_permissions where member_id = (select id from members where email = auth.email() limit 1);
    if scope = 'both' or scope is null then return true; end if;
    select id into my_co from companies where short_code = scope limit 1;
    return target_company = my_co;
  end if;
  if is_admin_tier() then return true; end if;
  if is_finance_manager() then
    if (select company from members where email = auth.email()) is null then return true; end if;
    select c.id into my_co from companies c join members m on m.email = auth.email() where c.name = m.company limit 1;
    return target_company = my_co;
  end if;
  return false;
end; $$;

create or replace function public.can_edit_company_finance(target_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select can_see_company_finance(target_company) and coalesce(perm_override('can_edit_finance'), true);
$$;
revoke execute on function public.can_edit_company_finance(uuid) from anon, public;
grant execute on function public.can_edit_company_finance(uuid) to authenticated;

alter policy finance_access on public.cash_opening_balance using (can_see_company_finance(company_id)) with check (can_edit_company_finance(company_id));
alter policy finance_access on public.monthly_cash_plan    using (can_see_company_finance(company_id)) with check (can_edit_company_finance(company_id));
alter policy finance_access on public.monthly_budgets      using (can_see_company_finance(company_id)) with check (can_edit_company_finance(company_id));
alter policy finance_access on public.daily_cash_position  using (can_see_company_finance(company_id)) with check (can_edit_company_finance(company_id));

create policy finance_delete_requires_edit on public.cash_opening_balance as restrictive for delete to public using (can_edit_company_finance(company_id));
create policy finance_delete_requires_edit on public.monthly_cash_plan    as restrictive for delete to public using (can_edit_company_finance(company_id));
create policy finance_delete_requires_edit on public.monthly_budgets      as restrictive for delete to public using (can_edit_company_finance(company_id));
create policy finance_delete_requires_edit on public.daily_cash_position  as restrictive for delete to public using (can_edit_company_finance(company_id));

commit;

-- Verified 17/10/2026 by impersonation (BEGIN…ROLLBACK): Abbasi sees IFPL only, cannot
-- update/insert/delete; Shakeel sees both + edits; Sania UTPL only; PA nothing.

-- ─── ROLLBACK ────────────────────────────────────────────────────────────────
-- begin;
-- drop policy finance_delete_requires_edit on public.cash_opening_balance;
-- drop policy finance_delete_requires_edit on public.monthly_cash_plan;
-- drop policy finance_delete_requires_edit on public.monthly_budgets;
-- drop policy finance_delete_requires_edit on public.daily_cash_position;
-- alter policy finance_access on public.cash_opening_balance using (can_see_company_finance(company_id)) with check (can_see_company_finance(company_id));
-- alter policy finance_access on public.monthly_cash_plan    using (can_see_company_finance(company_id)) with check (can_see_company_finance(company_id));
-- alter policy finance_access on public.monthly_budgets      using (can_see_company_finance(company_id)) with check (can_see_company_finance(company_id));
-- alter policy finance_access on public.daily_cash_position  using (can_see_company_finance(company_id)) with check (can_see_company_finance(company_id));
-- drop function public.can_edit_company_finance(uuid);
-- -- can_see_company_finance(): restore from migration history (pre-274 body compared members.company).
-- commit;
