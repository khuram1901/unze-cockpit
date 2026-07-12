-- ============================================================
-- 082: Merge Baranh + Haute Dolci into one "Restaurant" row
--
-- Khuram: both companies share the same Folderit account (Restaurants,
-- B9jVq0_u1U) and should show as ONE card on the Folderit page, labelled
-- "Restaurant" — even though they remain two separate companies
-- everywhere else in the app (separate cash/budgets, per rule 7).
--
-- get_folderit_company_breakdown now groups by a "group_key": either a
-- real company_uuid (as text, for every normal company) or the literal
-- 'restaurants' for Baranh + Haute Dolci combined. Every figure is
-- recomputed from the raw tables for the group, not by combining the two
-- companies' already-computed numbers — combining two "oldest days"
-- values naively would need MAX (the single oldest item across both),
-- not an average or sum, so recomputing directly is the safer approach.
-- ============================================================

drop function if exists get_folderit_company_breakdown();

create or replace function get_folderit_company_breakdown()
returns table (
  group_key               text,     -- real company_uuid (as text), or 'restaurants'
  inbox_count             integer,
  inbox_oldest_days       integer,
  pending_approval_count  integer,
  approval_oldest_days    integer
)
language sql
security definer
set search_path = public
as $$
  with mapped as (
    select
      ac.account_uid,
      case
        when ac.company_uuid in ('6401ba75-f297-4617-84c1-305bcaf35a50', '16a92b7f-b3fa-4271-819b-c6befb534f12')
          then 'restaurants'
        else ac.company_uuid::text
      end as group_key
    from folderit_account_companies ac
    group by ac.account_uid, 2
  )
  select
    m.group_key,
    (select count(*)::int
       from folderit_inbox_files f
       join folderit_account_map am on am.account_uid = f.account_uid
       where f.account_uid in (select account_uid from mapped where group_key = m.group_key)
         and am.is_active)                                                                as inbox_count,
    (select extract(day from now() - min(coalesce(f.created_at, f.synced_at)))::int
       from folderit_inbox_files f
       join folderit_account_map am on am.account_uid = f.account_uid
       where f.account_uid in (select account_uid from mapped where group_key = m.group_key)
         and am.is_active)                                                                as inbox_oldest_days,
    (select count(*)::int
       from folderit_resolution_invites ri
       join folderit_account_map am on am.account_uid = ri.account_uid
       where ri.account_uid in (select account_uid from mapped where group_key = m.group_key)
         and am.is_active
         and ri.status in ('pending', 'pendingInvite', 'active'))                         as pending_approval_count,
    (select extract(day from now() - min(coalesce(ri.created_at, ri.synced_at)))::int
       from folderit_resolution_invites ri
       join folderit_account_map am on am.account_uid = ri.account_uid
       where ri.account_uid in (select account_uid from mapped where group_key = m.group_key)
         and am.is_active
         and ri.status in ('pending', 'pendingInvite', 'active'))                         as approval_oldest_days
  from (select distinct group_key from mapped) m
$$;
