-- ============================================================
-- 089: Fix Folder-it page/preview slowness
--
-- Khuram: "Folderit is working very slow. When I go into that page, it
-- takes a while for the page to load, and also when we're trying to
-- look up the policies, it takes a bit of a while to pull up the
-- policy."
--
-- Root cause of the page-load slowness: PersonalApprovalsCard (the
-- "Pending my approval" stat card, shown at the top of AdminView, i.e.
-- Khuram's own view) calls GET /api/folderit/details with no ?company=
-- param. For an admin, that route passes p_company_uuid = null straight
-- through to get_folderit_details — and the RPC's company_inbox branch
-- treats "null" as "no filter", not "no company selected". That meant
-- every single load of the Folder-it page for Khuram was fetching and
-- transferring EVERY company's entire unfiled-document inbox, just to
-- immediately throw all of it away client-side except the handful of
-- rows where section = 'approval'. The "By Company" breakdown already
-- has its own dedicated, properly-scoped endpoint
-- (get_folderit_company_breakdown) — nothing ever actually needed this
-- unscoped blob.
--
-- Fix: get_folderit_details gains p_include_company_inbox (default
-- true, so every existing non-admin/company-scoped caller is
-- unaffected). The API route now passes false for the
-- admin-no-company-param case, so the company_inbox branch never even
-- runs for that request — not just filtered out afterwards.
-- ============================================================

drop function if exists get_folderit_details(text, uuid);

create or replace function get_folderit_details(
  p_user_email             text default null,
  p_company_uuid           uuid default null,
  p_include_company_inbox  boolean default true
)
returns table (
  section       text,      -- 'approval' | 'company_inbox'
  item_uid      text,      -- unique row id (invite uid for approvals, file uid for inbox)
  file_uid      text,      -- the actual Folderit file — always the right id to preview
  name          text,
  account_name  text,
  status        text,
  created_at    timestamptz,
  days_pending  integer
)
language sql
security definer
set search_path = public
as $$
  select
    'approval',
    ri.invite_uid,
    ri.file_uid,
    coalesce(ri.file_name, f.name, ri.entity_uid),
    am.account_name,
    ri.status,
    coalesce(ri.created_at, ri.synced_at),
    extract(day from now() - coalesce(ri.created_at, ri.synced_at))::int
  from folderit_resolution_invites ri
  join folderit_account_map am on am.account_uid = ri.account_uid
  left join folderit_inbox_files f on f.file_uid = ri.file_uid
  where am.is_active
    and ri.status in ('pending','pendingInvite','active')
    and (
      p_user_email is null
      or ri.email in (
        select alias_email from folderit_email_aliases where dashboard_email = p_user_email
        union
        select p_user_email
      )
    )
    and (
      p_company_uuid is null
      or exists (
        select 1 from folderit_account_companies ac
        where ac.account_uid = am.account_uid and ac.company_uuid = p_company_uuid
      )
    )
  union all
  select
    'company_inbox',
    f.file_uid,
    f.file_uid,
    f.name,
    am.account_name,
    null,
    f.created_at,
    extract(day from now() - coalesce(f.created_at, f.synced_at))::int
  from folderit_inbox_files f
  join folderit_account_map am on am.account_uid = f.account_uid
  where p_include_company_inbox
    and am.is_active and am.scope = 'company'
    and (
      p_company_uuid is null
      or exists (
        select 1 from folderit_account_companies ac
        where ac.account_uid = am.account_uid and ac.company_uuid = p_company_uuid
      )
    )
$$;
