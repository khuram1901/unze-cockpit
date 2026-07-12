-- 095_folderit_inbox_search.sql
--
-- Khuram: "search for inbox for all companies and for HR the Policies
-- folder plus inbox" — the HR half already existed (search_folderit_hr_files
-- already searches folderit_hr_category_files + the HR account's own
-- inbox). This adds the missing company half: a name search across every
-- COMPANY's unfiled inbox (not the HR account), scoped by the caller —
-- p_company_uuid = NULL means "no filter" and is only ever meant to be
-- passed by an admin/CEO caller; every other caller must pass their own
-- company_uuid. The API route (app/api/folderit/search/route.ts) is the
-- one place that decides which of those two a caller gets, and it never
-- lets a non-admin's missing company_id silently fall through to NULL —
-- same over-fetch bug class we already fixed once in
-- get_folderit_details (089_folderit_performance.sql).
--
-- Scoped via folderit_account_companies (the many-to-many company
-- mapping — same pattern as get_folderit_company_breakdown) rather than
-- am.scope, so the HR account ('global' scope) and any 'pending'/
-- 'excluded' accounts are naturally excluded: only accounts that
-- actually have a company mapping are searchable here.
--
-- Apply via Supabase SQL Editor.

drop function if exists search_folderit_inbox(text, uuid);

create or replace function search_folderit_inbox(p_query text, p_company_uuid uuid)
returns table (
  file_uid text,
  name text,
  account_name text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select distinct f.file_uid, f.name, am.account_name, f.created_at
  from folderit_inbox_files f
  join folderit_account_map am on am.account_uid = f.account_uid
  where am.is_active
    and f.name ilike '%' || p_query || '%'
    and exists (
      select 1 from folderit_account_companies ac
      where ac.account_uid = f.account_uid
        and (p_company_uuid is null or ac.company_uuid = p_company_uuid)
    )
  order by f.name
  limit 200
$$;
