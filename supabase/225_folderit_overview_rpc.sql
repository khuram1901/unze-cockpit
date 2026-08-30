-- Phase 4 (tech debt, rule 0): folderit/overview aggregation into Postgres.
-- Replaces the JS issue-counting / health-score loops in
-- app/api/folderit/overview/route.ts with one round-trip.
--
-- Access scoping stays in the route (resolveFolderitAccess); the resolved
-- account_uid list is passed in (null = admin sees all).
--
-- Behaviour change agreed with Khuram 30/08/2026: an account linked to more
-- than one company (B9jVq0_u1U -> Baranh AND HD) now counts its issues
-- against BOTH companies' health scores. The old JS used a last-link-wins
-- map, which assigned such issues to one arbitrary company per request.
--
-- Bug fix: the old route selected created_at from folderit_sync_log, but the
-- column is ran_at — the query failed silently and lastSyncAt was always
-- null. The RPC reads ran_at, so the Overview tab finally shows a sync time.

create or replace function public.get_folderit_overview(p_account_uids text[] default null)
returns jsonb
language sql
security definer
set search_path = public
as $$
with visible_issues as (
  select fhi.account_uid, fhi.issue_type
  from folderit_health_issues fhi
  where p_account_uids is null or fhi.account_uid = any(p_account_uids)
),
links as (
  select fac.account_uid, fac.company_uuid, c.name as company_name, (c.id is not null) as has_company
  from folderit_account_companies fac
  left join companies c on c.id = fac.company_uuid
),
seen_companies as (
  select distinct l.company_uuid, l.company_name
  from links l
  where l.has_company
    and (p_account_uids is null or l.account_uid = any(p_account_uids))
),
issues_by_company as (
  select l.company_uuid, vi.issue_type, count(*)::int as cnt
  from visible_issues vi
  join links l on l.account_uid = vi.account_uid
  group by l.company_uuid, vi.issue_type
),
company_summary as (
  select sc.company_uuid, sc.company_name,
    greatest(0, 100 - coalesce(sum(
      case ibc.issue_type
        when 'inbox_subfolder' then 10
        when 'buried_in_inbox' then 3
        when 'inbox_stale'     then 5
        when 'bad_filename'    then 2
        else 1
      end * ibc.cnt), 0))::int as score,
    coalesce(sum(ibc.cnt), 0)::int as total_issues,
    coalesce(jsonb_object_agg(ibc.issue_type, ibc.cnt) filter (where ibc.issue_type is not null), '{}'::jsonb) as breakdown
  from seen_companies sc
  left join issues_by_company ibc on ibc.company_uuid = sc.company_uuid
  group by sc.company_uuid, sc.company_name
),
breakdown_counts as (
  select issue_type, count(*)::int as cnt from visible_issues group by issue_type
),
last_sync as (
  select ran_at, ok from folderit_sync_log order by ran_at desc limit 1
)
select jsonb_build_object(
  'accounts', coalesce((
     select jsonb_agg(jsonb_build_object(
       'account_uid', account_uid, 'account_name', account_name, 'scope', scope
     ) order by account_name)
     from folderit_account_map
     where is_active = true and scope not in ('excluded', 'pending')
       and (p_account_uids is null or account_uid = any(p_account_uids))
  ), '[]'::jsonb),
  'healthSummary', coalesce((
     select jsonb_agg(jsonb_build_object(
       'company_uuid', cs.company_uuid,
       'company_name', cs.company_name,
       'score',        cs.score,
       'total_issues', cs.total_issues,
       'breakdown',    cs.breakdown
     ) order by cs.company_name)
     from company_summary cs
  ), '[]'::jsonb),
  'lastSyncAt', (select ran_at from last_sync),
  'lastSyncOk', (select ok from last_sync),
  'inboxFilesTotal', (select count(*)::int from folderit_inbox_files
     where p_account_uids is null or account_uid = any(p_account_uids)),
  'issueBreakdown', (
     select jsonb_build_object(
       'inbox_subfolder', coalesce((select cnt from breakdown_counts where issue_type = 'inbox_subfolder'), 0),
       'buried_in_inbox', coalesce((select cnt from breakdown_counts where issue_type = 'buried_in_inbox'), 0),
       'inbox_stale',     coalesce((select cnt from breakdown_counts where issue_type = 'inbox_stale'),     0),
       'bad_filename',    coalesce((select cnt from breakdown_counts where issue_type = 'bad_filename'),    0)
     ) || coalesce((
       select jsonb_object_agg(issue_type, cnt) from breakdown_counts
       where issue_type not in ('inbox_subfolder', 'buried_in_inbox', 'inbox_stale', 'bad_filename')
     ), '{}'::jsonb)
  )
);
$$;
