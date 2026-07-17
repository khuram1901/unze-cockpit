-- ============================================================
-- 076: Folderit reporting RPCs for the redesigned page
--
-- Two new read RPCs, both pure aggregation (Golden Rule):
--   get_folderit_company_breakdown() — one row per company, for the
--     CEO/Admin view (mirrors how Audit Dashboard shows all 6 companies).
--   get_folderit_hr_categories() — one row per HR sub-category
--     (currently just "Policies & SOPs"), file count each.
-- Plus two matching detail RPCs for the collapsible drill-down lists.
-- ============================================================

create or replace function get_folderit_company_breakdown()
returns table (
  company_uuid            uuid,
  inbox_count             integer,
  pending_approval_count  integer
)
language sql
security definer
set search_path = public
as $$
  select
    c.company_uuid,
    (select count(*)::int from folderit_inbox_files f
       join folderit_account_map am on am.account_uid = f.account_uid
       where am.company_uuid = c.company_uuid and am.is_active)             as inbox_count,
    (select count(*)::int from folderit_resolution_invites ri
       join folderit_account_map am on am.account_uid = ri.account_uid
       where am.company_uuid = c.company_uuid and am.is_active
         and ri.status in ('pending','pendingInvite','active'))             as pending_approval_count
  from (
    select distinct company_uuid from folderit_account_map
    where scope = 'company' and company_uuid is not null
  ) c
$$;

create or replace function get_folderit_hr_categories()
returns table (
  category_name text,
  file_count    integer,
  sort_order    integer
)
language sql
security definer
set search_path = public
as $$
  select hc.category_name, count(f.file_uid)::int as file_count, hc.sort_order
  from folderit_hr_categories hc
  left join folderit_hr_category_files f on f.category_name = hc.category_name
  where hc.is_active
  group by hc.category_name, hc.sort_order
  order by hc.sort_order
$$;

create or replace function get_folderit_hr_category_files(p_category_name text)
returns table (
  file_uid   text,
  name       text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select file_uid, name, created_at
  from folderit_hr_category_files
  where category_name = p_category_name
  order by created_at desc nulls last
$$;
