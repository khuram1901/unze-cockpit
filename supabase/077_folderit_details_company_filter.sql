-- ============================================================
-- 077: get_folderit_details() — also filter approvals by company
--
-- The original version (074) only filtered the approval section by
-- p_user_email. That's fine for a member's own view, but the new CEO
-- "click a company row to expand" drill-down needs approvals scoped to
-- one company too (with p_user_email left null to show everyone's
-- pending approvals within that company). Re-creating with both filters
-- applied to the approval section.
-- ============================================================

create or replace function get_folderit_details(
  p_user_email   text default null,
  p_company_uuid uuid default null
)
returns table (
  section       text,      -- 'approval' | 'company_inbox' | 'hr_inbox'
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
    and (p_company_uuid is null or am.company_uuid = p_company_uuid)
  union all
  select 'company_inbox', f.file_uid, f.name, am.account_name, null, f.created_at
  from folderit_inbox_files f
  join folderit_account_map am on am.account_uid = f.account_uid
  where am.is_active and am.scope = 'company'
    and (p_company_uuid is null or am.company_uuid = p_company_uuid)
  union all
  select 'hr_inbox', f.file_uid, f.name, am.account_name, null, f.created_at
  from folderit_inbox_files f
  join folderit_account_map am on am.account_uid = f.account_uid
  where am.is_active and am.scope = 'global'
$$;
