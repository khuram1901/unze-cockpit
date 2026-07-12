-- ============================================================
-- 074: Folderit DMS integration — Stage 1 (read-only status dashboard)
--
-- Folderit's client-credentials token sees MULTIPLE separate accounts,
-- not one account with company sub-folders. Each account already carries
-- its own inboxFolderUid (from GET /v2/accounts), so no manual folder
-- hunting is needed — just a mapping of Folderit account -> our company.
--
-- Mapping confirmed with Khuram (2026-07-12):
--   pNeZ609Mgw  Unze Trading        -> UTPL
--   YUsup0PqWr  Imperial Footwear   -> IFPL
--   6cVIn0up6S  Unze London         -> IFPL (bundled — same access as Imperial)
--   B9jVq0_u1U  Restaurants         -> BRNH (Baranh; Folderit account name is legacy)
--   dYjdc0Ev6N  Family Documents    -> DIR
--   2ztVT0f2yX  Human Resource      -> global (visible to every logged-in user)
--   fEKAm0deuD  S&W London          -> excluded (no longer relevant)
--   JsXvG0hu5g  S&M Investments     -> pending (unmapped — deferred, not synced yet)
--
-- Haute Dolci (HD) and Almahar (ALM) have no Folderit account yet.
-- Their inbox/approval counts will simply read 0 until one is mapped —
-- add a row to folderit_account_map when that's sorted.
-- ============================================================

create table if not exists folderit_account_map (
  account_uid     text primary key,          -- Folderit account uid
  account_name    text not null,             -- display name as it exists in Folderit
  company_uuid    uuid references companies(id),  -- null for scope = 'global'/'excluded'/'pending'
  scope           text not null default 'company'
                    check (scope in ('company','global','excluded','pending')),
  inbox_folder_uid text,                     -- from account.inboxFolderUid
  is_active       boolean not null default true,
  updated_at      timestamptz not null default now()
);

insert into folderit_account_map (account_uid, account_name, company_uuid, scope, inbox_folder_uid) values
  ('pNeZ609Mgw', 'Unze Trading',     '15884c2d-48a4-4d43-be90-0ef6e130790c', 'company', 'hBtY-09nIB'),
  ('YUsup0PqWr', 'Imperial Footwear','77921705-8a15-4406-847a-b234f84b5ec3', 'company', 'GQrk60JL5G'),
  ('6cVIn0up6S', 'Unze London',      '77921705-8a15-4406-847a-b234f84b5ec3', 'company', 'zhVbc0kMgv'),
  ('B9jVq0_u1U', 'Restaurants',      '6401ba75-f297-4617-84c1-305bcaf35a50', 'company', 'QBOKD08VZ3'),
  ('dYjdc0Ev6N', 'Family Documents', 'e867582b-2093-4d10-8eaf-de54a168ee55', 'company', 'Ro26Z0JxRP'),
  ('2ztVT0f2yX', 'Human Resource',   null,                                    'global',  'e4zUw0SxrQ'),
  ('fEKAm0deuD', 'S&W London',       null,                                    'excluded','Nrlgw0Sh9p'),
  ('JsXvG0hu5g', 'S&M Investments',  null,                                    'pending', 'sFEX80YUcg')
on conflict (account_uid) do update set
  account_name = excluded.account_name,
  company_uuid = excluded.company_uuid,
  scope        = excluded.scope,
  inbox_folder_uid = excluded.inbox_folder_uid,
  updated_at   = now();

-- Files currently sitting in a mail-in inbox folder, not yet filed elsewhere.
create table if not exists folderit_inbox_files (
  file_uid     text primary key,
  account_uid  text not null references folderit_account_map(account_uid),
  name         text,
  created_at   timestamptz,
  synced_at    timestamptz not null default now()
);
create index if not exists idx_folderit_inbox_files_account on folderit_inbox_files(account_uid);

-- Per-person approval tasks (Folderit "resolution invite" objects).
create table if not exists folderit_resolution_invites (
  invite_uid     text primary key,
  resolution_uid text not null,
  file_uid       text,
  entity_uid     text not null,
  account_uid    text not null references folderit_account_map(account_uid),
  email          text not null,
  status         text not null,   -- pending | pendingInvite | active | approved | rejected
  invite_order   integer,
  synced_at      timestamptz not null default now()
);
create index if not exists idx_folderit_invites_email_status on folderit_resolution_invites(email, status);
create index if not exists idx_folderit_invites_account on folderit_resolution_invites(account_uid);

-- ── RPC — all counting happens here, never client-side (Golden Rule) ──
create or replace function get_folderit_summary(
  p_user_email   text default null,   -- null = everyone's approvals (CEO/Admin)
  p_company_uuid uuid default null    -- null = every company's inbox (CEO/Admin)
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
        and (p_company_uuid is null or am.company_uuid = p_company_uuid)
    ) as company_inbox_count,
    (
      select count(*)::int
      from folderit_inbox_files f
      join folderit_account_map am on am.account_uid = f.account_uid
      where am.is_active and am.scope = 'global'
    ) as hr_inbox_count
$$;

-- Detail RPC for the dedicated /folderit page (drill-down lists).
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
