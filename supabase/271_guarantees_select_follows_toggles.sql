-- Migration 271: guarantees SELECT policies follow the Access Matrix toggles — 17/10/2026
-- Applied to production 17/10/2026.
--
-- The SELECT policies used is_finance_manager(), which checks department =
-- 'Finance' (no longer exists). "Fixing" it to 'Finance & Tax' would have
-- granted direct table reads to people Khuram explicitly excluded. Instead the
-- policies now use a function that mirrors app/lib/guarantee-access.ts, so
-- direct DB reads match the page exactly. is_finance_manager() is left as-is
-- (still referenced by department_budgets policies).

begin;

create or replace function public.can_view_guarantees_db()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when m.role = 'Executive' or m.email = 'pa.ceo@unze.co.uk' then false
      when p.can_view_guarantees is not null then p.can_view_guarantees
      when m.role in ('Admin','CEO') then true
      else m.role in ('Manager','Director')
           and m.department in ('Finance & Tax','Unze Trading Operations')
    end
    from members m
    left join member_permissions p on p.member_id = m.id
    where m.email = auth.email() and m.is_active
  ), false);
$$;
revoke execute on function public.can_view_guarantees_db() from anon, public;
grant execute on function public.can_view_guarantees_db() to authenticated;

alter policy guarantees_select on public.guarantees using (can_view_guarantees_db());
alter policy guarantee_facilities_select on public.guarantee_facilities using (can_view_guarantees_db());

commit;

-- ─── ROLLBACK ────────────────────────────────────────────────────────────────
-- begin;
-- alter policy guarantees_select on public.guarantees using (is_admin_tier() or is_finance_manager());
-- alter policy guarantee_facilities_select on public.guarantee_facilities using (is_admin_tier() or is_finance_manager());
-- drop function public.can_view_guarantees_db();
-- commit;
