-- ============================================================
-- 084: Approvals are personal, not company-wide + file viewing
--
-- Khuram: "These approvals are obviously wrong... I'm assuming these
-- approvals are from every manager to every assistant, every user in the
-- system, which is incorrect. For me as a CEO, I should only see my
-- approvals that are outstanding... Every user should see their approvals
-- only, not the entire company."
--
-- Chosen fix (his pick from the options given): approvals become
-- personal-only everywhere, including for the CEO/Admin. The per-company
-- cards keep their Inbox count (a real shared/company-wide concept —
-- documents landed but not yet filed by anyone) but drop the Approvals
-- number entirely, since who has to approve what is inherently a
-- per-person thing, never a per-company one.
--
-- Also adds get_folderit_file_account(), used by the new
-- /api/folderit/file-url route so people can actually click a document
-- and open it — previously only names were listed with no way to view.
-- ============================================================

-- ── Company breakdown: Inbox only, Approvals dropped ──
-- Explicit DROP required — CREATE OR REPLACE cannot shrink a table
-- function's output column list.
drop function if exists get_folderit_company_breakdown();

create or replace function get_folderit_company_breakdown()
returns table (
  group_key         text,     -- real company_uuid (as text), or 'restaurants'
  inbox_count       integer,
  inbox_oldest_days integer
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
         and am.is_active)                                                                as inbox_oldest_days
  from (select distinct group_key from mapped) m
$$;

-- ── Overdue banner: unfiled inbox documents only. A shared company inbox
--    sitting unfiled for a week is a real company-wide exception worth a
--    CEO banner. An individual's pending approval is not — same reasoning
--    as above — so the 'approval' branch of this UNION is removed.
drop function if exists get_folderit_overdue_items(integer);

create or replace function get_folderit_overdue_items(
  p_threshold_days integer default 7
)
returns table (
  section       text,      -- always 'company_inbox' now
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
    'company_inbox' as section, f.file_uid as item_uid, f.name, am.account_name,
    ac.company_uuid, extract(day from now() - coalesce(f.created_at, f.synced_at))::int as days_pending
  from folderit_inbox_files f
  join folderit_account_map am on am.account_uid = f.account_uid
  join folderit_account_companies ac on ac.account_uid = f.account_uid
  where am.is_active and am.scope = 'company'
    and extract(day from now() - coalesce(f.created_at, f.synced_at)) >= p_threshold_days
  order by days_pending desc
$$;

-- ── File viewing: resolve which Folderit account a file belongs to, so
--    the frontend can ask for a live download link with nothing more than
--    the file_uid it already has, no need to know Folderit's internal
--    account_uid. Checked across all three places a file can live.
create or replace function get_folderit_file_account(p_file_uid text)
returns text
language sql
security definer
set search_path = public
as $$
  select account_uid from folderit_inbox_files where file_uid = p_file_uid
  union
  select account_uid from folderit_resolution_invites where file_uid = p_file_uid
  union
  select hc.account_uid
    from folderit_hr_category_files f
    join folderit_hr_categories hc on hc.category_name = f.category_name
   where f.file_uid = p_file_uid
  limit 1
$$;
