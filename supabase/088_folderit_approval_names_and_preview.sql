-- ============================================================
-- 088: Real document names for approvals + fix preview on approval items
--
-- Khuram: "the documents in the approval section... I don't recognize any
-- of them. Their names are gibberish... Also, I'm not able to open any of
-- those documents for a preview."
--
-- Two separate bugs, both in how approvals were represented:
--
-- 1. Names — get_folderit_details showed coalesce(f.name, ri.entity_uid)
--    for approvals. f.name only resolves if the file happens to still be
--    sitting in folderit_inbox_files; most approval-workflow files have
--    already been filed elsewhere by the time an approval is pending, so
--    it fell back to ri.entity_uid — Folderit's raw internal id, which
--    looks like gibberish. The sync route (app/api/folderit/sync/route.ts)
--    now fetches each approval file's real name directly from Folderit
--    and stores it on the invite row (file_name), so this table has the
--    right name whether or not the file is still in the inbox.
--
-- 2. Preview — item_uid for the 'approval' section was ri.invite_uid (the
--    INVITE's own Folderit id), not the FILE's id. The frontend's preview
--    button asks get_folderit_file_account(item_uid) to resolve which
--    Folderit account a file lives in — but that function only knows how
--    to look up FILE uids, so an invite uid never matched anything and
--    every approval preview failed with "File not found". Fix: expose the
--    file's own uid as a separate file_uid column (item_uid stays the
--    invite uid, since that's what keeps each row unique when the same
--    file has more than one pending invite), and the frontend now asks
--    for a preview using file_uid when present.
-- ============================================================

alter table folderit_resolution_invites
  add column if not exists file_name text;

-- Explicit DROP required — adding a column to the output changes the
-- table function's column list, which CREATE OR REPLACE can't do.
drop function if exists get_folderit_details(text, uuid);

create or replace function get_folderit_details(
  p_user_email   text default null,
  p_company_uuid uuid default null
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
  where am.is_active and am.scope = 'company'
    and (
      p_company_uuid is null
      or exists (
        select 1 from folderit_account_companies ac
        where ac.account_uid = am.account_uid and ac.company_uuid = p_company_uuid
      )
    )
$$;
