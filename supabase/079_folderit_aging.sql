-- ============================================================
-- 079: Dwelling-time ("how many days has this been sitting here")
--
-- Khuram wants the CEO view to show, per company, how many documents are
-- pending and how long they've been waiting — not just a raw count. This
-- adds:
--   1. created_at on folderit_resolution_invites (Folderit's invite
--      object has its own createdAt — captured from now on by the sync
--      route, see app/api/folderit/sync/route.ts).
--   2. days_pending on get_folderit_details, so each file in an expanded
--      list shows its own age.
--   3. inbox_oldest_days / approval_oldest_days on
--      get_folderit_company_breakdown, for the admin per-company summary.
-- All day-count math happens here in Postgres, never in the frontend.
-- ============================================================

alter table folderit_resolution_invites
  add column if not exists created_at timestamptz;

-- ── get_folderit_details: add days_pending ──
drop function if exists get_folderit_details(text, uuid);

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
    coalesce(f.name, ri.entity_uid),
    am.account_name,
    ri.status,
    coalesce(ri.created_at, ri.synced_at),
    extract(day from now() - coalesce(ri.created_at, ri.synced_at))::int
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
  select
    'company_inbox',
    f.file_uid,
    f.name,
    am.account_name,
    null,
    f.created_at,
    extract(day from now() - coalesce(f.created_at, f.synced_at))::int
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

-- ── get_folderit_company_breakdown: add oldest-day aging per box ──
create or replace function get_folderit_company_breakdown()
returns table (
  company_uuid            uuid,
  inbox_count             integer,
  inbox_oldest_days       integer,
  pending_approval_count  integer,
  approval_oldest_days    integer
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
       where ac.company_uuid = c.company_uuid and am.is_active)                as inbox_count,
    (select extract(day from now() - min(coalesce(f.created_at, f.synced_at)))::int
       from folderit_inbox_files f
       join folderit_account_companies ac on ac.account_uid = f.account_uid
       join folderit_account_map am on am.account_uid = f.account_uid
       where ac.company_uuid = c.company_uuid and am.is_active)                as inbox_oldest_days,
    (select count(*)::int from folderit_resolution_invites ri
       join folderit_account_companies ac on ac.account_uid = ri.account_uid
       join folderit_account_map am on am.account_uid = ri.account_uid
       where ac.company_uuid = c.company_uuid and am.is_active
         and ri.status in ('pending','pendingInvite','active'))                as pending_approval_count,
    (select extract(day from now() - min(coalesce(ri.created_at, ri.synced_at)))::int
       from folderit_resolution_invites ri
       join folderit_account_companies ac on ac.account_uid = ri.account_uid
       join folderit_account_map am on am.account_uid = ri.account_uid
       where ac.company_uuid = c.company_uuid and am.is_active
         and ri.status in ('pending','pendingInvite','active'))                as approval_oldest_days
  from (select distinct company_uuid from folderit_account_companies) c
$$;

-- ── Cross-company overdue list, for the CEO alert banner ──
-- Mirrors the "N audits past target date" banner already used on the Audit
-- page (see app/department/[slug]/AuditDashboard.tsx) — same visual
-- language, applied here to "documents sitting too long."
create or replace function get_folderit_overdue_items(
  p_threshold_days integer default 7
)
returns table (
  section       text,      -- 'approval' | 'company_inbox'
  item_uid      text,
  name          text,
  account_name  text,
  company_uuid  uuid,
  days_pending  integer
)
language sql
security definer
set search_path = public
as $$
  select
    'approval', ri.invite_uid, coalesce(f.name, ri.entity_uid), am.account_name,
    ac.company_uuid, extract(day from now() - coalesce(ri.created_at, ri.synced_at))::int
  from folderit_resolution_invites ri
  join folderit_account_map am on am.account_uid = ri.account_uid
  join folderit_account_companies ac on ac.account_uid = ri.account_uid
  left join folderit_inbox_files f on f.file_uid = ri.file_uid
  where am.is_active
    and ri.status in ('pending','pendingInvite','active')
    and extract(day from now() - coalesce(ri.created_at, ri.synced_at)) >= p_threshold_days
  union all
  select
    'company_inbox', f.file_uid, f.name, am.account_name,
    ac.company_uuid, extract(day from now() - coalesce(f.created_at, f.synced_at))::int
  from folderit_inbox_files f
  join folderit_account_map am on am.account_uid = f.account_uid
  join folderit_account_companies ac on ac.account_uid = f.account_uid
  where am.is_active and am.scope = 'company'
    and extract(day from now() - coalesce(f.created_at, f.synced_at)) >= p_threshold_days
  order by days_pending desc
$$;
