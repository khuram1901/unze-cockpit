-- ============================================================
-- 087: Match "my approvals" across known email variants
--
-- Diagnostic query Khuram ran showed approvals under both
-- k.saleem@unzegroup.com (1, pendingInvite) and k.saleem@unze.co.uk (3,
-- active) — unze.co.uk is the domain his own staff use throughout the
-- rest of that data (daniyal@, zeeshan@, nadeem.khan@, etc.), so that one
-- is clearly the same person under a legacy domain. A third variant,
-- k.saleem@unze.com.uk, also showed up (4, pendingInvite) but Khuram
-- didn't recognise it and it appears nowhere else in the data — NOT
-- included here until he's confirmed via Folderit's own user directory
-- whose mailbox that actually is. Add it later with its own migration if
-- it turns out to be him.
--
-- Our RPCs were matching ri.email = <whatever email he's logged into the
-- dashboard with> exactly — so only whichever ONE variant matched his
-- current login showed up. Fix is a small alias table the
-- personal-approval RPCs consult instead of an exact string match.
--
-- dashboard_email = the email someone logs into THIS app with.
-- alias_email     = an email Folderit might have recorded their
--                    approvals under instead. A dashboard_email always
--                    matches its own address too (see the UNION in both
--                    RPCs below), so people with no configured aliases
--                    are unaffected.
-- ============================================================

create table if not exists folderit_email_aliases (
  dashboard_email text not null,
  alias_email     text not null,
  primary key (dashboard_email, alias_email)
);

-- Khuram logs in as either the CEO account (k.saleem@unzegroup.com) or
-- the Admin account (khuram1901@gmail.com) — same real person, so both
-- get the same alias set.
insert into folderit_email_aliases (dashboard_email, alias_email) values
  ('k.saleem@unzegroup.com', 'k.saleem@unze.co.uk'),
  ('khuram1901@gmail.com',   'k.saleem@unzegroup.com'),
  ('khuram1901@gmail.com',   'k.saleem@unze.co.uk')
on conflict (dashboard_email, alias_email) do nothing;

-- ── get_folderit_summary: match alias set instead of exact email ──
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
        and (
          p_user_email is null
          or ri.email in (
            select alias_email from folderit_email_aliases where dashboard_email = p_user_email
            union
            select p_user_email
          )
        )
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

-- ── get_folderit_details: same alias-set match for the 'approval' branch ──
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
