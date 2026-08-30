-- 221: Phase 3b — P&L branch lines linked to the locations master
-- ─────────────────────────────────────────────────────────────────
-- rest_pnl_lines and ifpl_pnl_lines keep their branch text (display is
-- unchanged) but gain location_id → admin_locations. Matching:
--   1. pnl_branch_aliases (seeded for spelling variants: "Y-Block" →
--      DHA Y Block, "Packages" → Packages Mall, "Faisalabad KN" → Kooh I Noor)
--   2. case-insensitive exact name match within the right entity
-- match_pnl_branches() runs after every P&L upload; unmatched branches
-- are logged as 'branch_unmapped' lifecycle events for review.
-- Known unmatched left for Khuram: IFPL "Islamabad", "Mall of Sailkot",
-- "ONLINE PK" (online channel — may deliberately have no location).
-- ─────────────────────────────────────────────────────────────────

alter table rest_pnl_lines add column if not exists location_id uuid references admin_locations(id);
alter table ifpl_pnl_lines add column if not exists location_id uuid references admin_locations(id);

create table if not exists pnl_branch_aliases (
  id          uuid primary key default gen_random_uuid(),
  company     text not null,     -- 'BARANH' | 'HD' | 'IFPL'
  branch      text not null,     -- branch text as it appears in uploads
  location_id uuid not null references admin_locations(id),
  unique (company, branch)
);
alter table pnl_branch_aliases enable row level security;
do $pol$ begin
  if not exists (select 1 from pg_policies where tablename = 'pnl_branch_aliases' and policyname = 'branch_alias_admin') then
    create policy branch_alias_admin on pnl_branch_aliases for all using (is_admin_tier());
  end if;
end $pol$;

-- Seed aliases for known spelling variants
insert into pnl_branch_aliases (company, branch, location_id)
select v.company, v.branch, l.id
from (values
  ('BARANH','Y-Block','DHA Y Block','Baranh'),
  ('BARANH','Packages','Packages Mall','Baranh'),
  ('HD','Y-Block','DHA Y Block','HD'),
  ('HD','Packages','Packages Mall','HD'),
  ('HD','Dolmen','Dolmen Mall','HD'),
  ('IFPL','Faisalabad KN','Kooh I Noor','IFPL')
) as v(company, branch, loc_name, ent)
join admin_locations l on l.name = v.loc_name and l.entity = v.ent
on conflict (company, branch) do nothing;

create or replace function match_pnl_branches()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Restaurants: company BARANH → entity Baranh, HD → HD
  update rest_pnl_lines r set location_id = a.location_id
  from pnl_branch_aliases a
  where r.location_id is null and a.company = r.company and a.branch = r.branch;

  update rest_pnl_lines r set location_id = l.id
  from admin_locations l
  where r.location_id is null
    and lower(l.name) = lower(r.branch)
    and l.entity = case r.company when 'BARANH' then 'Baranh' else r.company end;

  -- IFPL
  update ifpl_pnl_lines r set location_id = a.location_id
  from pnl_branch_aliases a
  where r.location_id is null and a.company = 'IFPL' and a.branch = r.branch;

  update ifpl_pnl_lines r set location_id = l.id
  from admin_locations l
  where r.location_id is null
    and lower(l.name) = lower(r.branch)
    and l.entity = 'IFPL';

  -- Log unmatched branches (once per 7 days per branch)
  insert into flw_lifecycle_events (event_type, detail)
  select 'branch_unmapped', 'P&L branch "' || b.branch || '" (' || b.company || ') has no master location'
  from (
    select distinct company, branch from rest_pnl_lines where location_id is null
    union
    select distinct 'IFPL', branch from ifpl_pnl_lines where location_id is null
  ) b
  where not exists (
    select 1 from flw_lifecycle_events ev
    where ev.event_type = 'branch_unmapped' and ev.detail like '%"' || b.branch || '"%'
      and ev.created_at > now() - interval '7 days');
end;
$$;

select match_pnl_branches();

-- ── Aliases confirmed by Khuram 30/08/2026 (applied directly) ──────
-- 'ONLINE PK' → new virtual location 'Online' (IFPL, type 'online')
-- 'Islamabad' → Centaurus Mall (Store 028 — runs in parallel with Capital Square)
-- 'Mall of Sailkot' → Sialkot Store (renamed/relocated from July 2026 file)
-- Result: 100% of rest_pnl_lines and ifpl_pnl_lines mapped to master locations.
