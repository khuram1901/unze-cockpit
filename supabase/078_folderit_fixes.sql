-- ============================================================
-- 078: Folderit fixes from first real usage
--
-- 1. Many-to-many company <-> account mapping. The old model assumed
--    one Folderit account belongs to at most one company. Reality: the
--    "Restaurants" account (B9jVq0_u1U) covers BOTH Baranh and Haute
--    Dolci — one account, two companies. New join table replaces the
--    single company_uuid column on folderit_account_map.
--
-- 2. get_folderit_details' hr_inbox branch had no company filter, so it
--    leaked into every company's drill-down in the admin view. Removed
--    from get_folderit_details entirely — HR now only ever comes from
--    the dedicated get_folderit_hr_categories/get_folderit_hr_inbox RPCs.
-- ============================================================

-- ── 1. Many-to-many company/account mapping ──
create table if not exists folderit_account_companies (
  account_uid  text not null references folderit_account_map(account_uid),
  company_uuid uuid not null references companies(id),
  primary key (account_uid, company_uuid)
);

insert into folderit_account_companies (account_uid, company_uuid)
values
  ('pNeZ609Mgw', '15884c2d-48a4-4d43-be90-0ef6e130790c'), -- Unze Trading -> UTPL
  ('YUsup0PqWr', '77921705-8a15-4406-847a-b234f84b5ec3'), -- Imperial Footwear -> IFPL
  ('6cVIn0up6S', '77921705-8a15-4406-847a-b234f84b5ec3'), -- Unze London -> IFPL
  ('B9jVq0_u1U', '6401ba75-f297-4617-84c1-305bcaf35a50'), -- Restaurants -> BRNH
  ('B9jVq0_u1U', '16a92b7f-b3fa-4271-819b-c6befb534f12'), -- Restaurants -> HD (shared account)
  ('dYjdc0Ev6N', 'e867582b-2093-4d10-8eaf-de54a168ee55')  -- Family Documents -> DIR
on conflict (account_uid, company_uuid) do nothing;

-- Drop the old single-company column now that RPCs below no longer use it.
alter table folderit_account_map drop column if exists company_uuid;

-- ── Re-create RPCs to join through the new table ──

create or replace function get_folderit_summary(
  p_user_email   text default null,
  p_company_uuid uuid default null
)
returns table (
  pending_approval_count  integer,
  company_inbox_count     integer,
  hr_inbox_count          integer
)
language sql
security definer
set search_path = public
as $$
  select
    (
      select count(*)::int
      from folderit_resolution_invites ri
      join folderit_account_map am on am.account_uid = ri.account_uid
      where am.is_active
        and ri.status in ('pending','pendingInvite','active')
        and (p_user_email is null or ri.email = p_user_email)
    ) as pending_approval_count,
    (
      select count(*)::int
      from folderit_inbox_files f
      join folderit_account_map am on am.account_uid = f.account_uid
      where am.is_active and am.scope = 'company'
        and (
          p_company_uuid is null
          or exists (
            select 1 from folderit_account_companies ac
            where ac.account_uid = am.account_uid and ac.company_uuid = p_company_uuid
          )
        )
    ) as company_inbox_count,
    (
      select count(*)::int
      from folderit_inbox_files f
      join folderit_account_map am on am.account_uid = f.account_uid
      where am.is_active and am.scope = 'global'
    ) as hr_inbox_count
$$;

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
       join folderit_account_companies ac on ac.account_uid = f.account_uid
       join folderit_account_map am on am.account_uid = f.account_uid
       where ac.company_uuid = c.company_uuid and am.is_active)             as inbox_count,
    (select count(*)::int from folderit_resolution_invites ri
       join folderit_account_companies ac on ac.account_uid = ri.account_uid
       join folderit_account_map am on am.account_uid = ri.account_uid
       where ac.company_uuid = c.company_uuid and am.is_active
         and ri.status in ('pending','pendingInvite','active'))             as pending_approval_count
  from (select distinct company_uuid from folderit_account_companies) c
$$;

-- hr_inbox branch removed — HR is exclusively served by
-- get_folderit_hr_categories / get_folderit_hr_inbox now, never mixed
-- into a company's own drill-down.
create or replace function get_folderit_details(
  p_user_email   text default null,
  p_company_uuid uuid default null
)
returns table (
  section       text,      -- 'approval' | 'company_inbox'
  item_uid      text,
  name          text,
  account_name  text,
  status        text,
  created_at    timestamptz
)
language sql
security definer
set search_path = public
as $$
  select 'approval', ri.invite_uid, coalesce(f.name, ri.entity_uid), am.account_name, ri.status, ri.synced_at
  from folderit_resolution_invites ri
  join folderit_account_map am on am.account_uid = ri.account_uid
  left join folderit_inbox_files f on f.file_uid = ri.file_uid
  where am.is_active
    and ri.status in ('pending','pendingInvite','active')
    and (p_user_email is null or ri.email = p_user_email)
    and (
      p_company_uuid is null
      or exists (
        select 1 from folderit_account_companies ac
        where ac.account_uid = am.account_uid and ac.company_uuid = p_company_uuid
      )
    )
  union all
  select 'company_inbox', f.file_uid, f.name, am.account_name, null, f.created_at
  from folderit_inbox_files f
  join folderit_account_map am on am.account_uid = f.account_uid
  where am.is_active and am.scope = 'company'
    and (
      p_company_uuid is null
      or exists (
        select 1 from folderit_account_companies ac
        where ac.account_uid = am.account_uid and ac.company_uuid = p_company_uuid
      )
    )
$$;

-- New dedicated RPC for the global HR inbox list (previously bundled,
-- incorrectly, into get_folderit_details).
create or replace function get_folderit_hr_inbox()
returns table (
  file_uid     text,
  name         text,
  account_name text,
  created_at   timestamptz
)
language sql
security definer
set search_path = public
as $$
  select f.file_uid, f.name, am.account_name, f.created_at
  from folderit_inbox_files f
  join folderit_account_map am on am.account_uid = f.account_uid
  where am.is_active and am.scope = 'global'
  order by f.created_at desc nulls last
$$;
