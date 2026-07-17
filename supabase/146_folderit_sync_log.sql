-- Diagnostic table for the Folderit sync cron (runs every 30 min).
--
-- Why: /api/folderit/sync already computes rich debug info every run
-- (auditEntriesScanned, candidatesFound, distinct event types seen, and any
-- errors) but only ever returns it in the HTTP response — and nobody calls
-- that endpoint to look at the response, Vercel just fires the cron and
-- discards it. Result: folderit_resolution_invites has been sitting at ZERO
-- rows for an unknown stretch of time despite 8 active Folderit accounts,
-- with no trace anywhere of why. This table gives every run a permanent,
-- queryable record so that next time something silently breaks we can see
-- exactly where (0 candidates found = audit trail isn't matching anything;
-- candidates found but 0 invites = the resolutions/invites fetch is
-- failing; explicit errors = network/auth failure).
--
-- Not wired into any UI yet — query it directly in the SQL editor for now.
-- Admin/CEO can read it if a UI is ever built on top.

create table if not exists public.folderit_sync_log (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  ok boolean not null,
  accounts_synced int not null default 0,
  inbox_files_synced int not null default 0,
  invites_synced int not null default 0,
  hr_files_synced int not null default 0,
  audit_entries_scanned int not null default 0,
  candidates_found int not null default 0,
  distinct_event_types text[] not null default '{}',
  errors text[] not null default '{}'
);

alter table public.folderit_sync_log enable row level security;

drop policy if exists folderit_sync_log_admin_select on public.folderit_sync_log;
create policy folderit_sync_log_admin_select on public.folderit_sync_log
  for select
  using (
    (select auth.email()) in (
      select email from public.members where role in ('Admin', 'CEO')
    )
  );

-- Keep the table small — nobody needs sync history older than 2 weeks for
-- a cron that runs every 30 minutes (that's already ~670 rows).
create or replace function public.prune_folderit_sync_log()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.folderit_sync_log where ran_at < now() - interval '14 days';
$$;
