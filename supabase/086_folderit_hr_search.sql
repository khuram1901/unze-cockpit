-- ============================================================
-- 086: Search HR documents by name from the main Folderit page
--
-- Khuram: "I need you to build in the search option where I can search
-- for the policy on the main page."
--
-- One RPC, name-only search across both HR sources (categorised files —
-- Policies & SOPs, etc. — and the general HR inbox), so the frontend
-- doesn't need to fetch every category's files client-side just to filter
-- them in JS. Capped at 200 results; ordered alphabetically.
-- ============================================================

create or replace function search_folderit_hr_files(p_query text)
returns table (
  file_uid      text,
  name          text,
  category_name text,      -- null for HR inbox items (not yet filed into a category)
  folder_path   text,      -- null for HR inbox items, or files sitting in a category's root
  created_at    timestamptz
)
language sql
security definer
set search_path = public
as $$
  select f.file_uid, f.name, f.category_name, f.folder_path, f.created_at
  from folderit_hr_category_files f
  where f.name ilike '%' || p_query || '%'
  union all
  select f.file_uid, f.name, null::text as category_name, null::text as folder_path, f.created_at
  from folderit_inbox_files f
  join folderit_account_map am on am.account_uid = f.account_uid
  where am.is_active and am.scope = 'global'
    and f.name ilike '%' || p_query || '%'
  order by name
  limit 200
$$;
