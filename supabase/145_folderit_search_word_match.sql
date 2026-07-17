-- Fix: Folderit search only matched the entire typed phrase as ONE literal
-- substring (ILIKE '%exact phrase%'). Real filenames use underscores,
-- hyphens, or extra words in between ("Employee_Handbook_2026.pdf"), so
-- typing "Employee Handbook" found nothing even though the file exists —
-- confirmed live: 627 HR files exist, and calling this function directly
-- with a single word ("Proposal") DID return correct matches, so the
-- function itself works, it's just too literal for multi-word searches.
--
-- Now every whitespace-separated word in the query must appear SOMEWHERE
-- in the filename (in any order) — the way a normal search box behaves.

create or replace function public.search_folderit_hr_files(p_query text)
returns table(file_uid text, name text, category_name text, folder_path text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  with words as (
    select array_remove(string_to_array(trim(p_query), ' '), '') as w
  )
  select f.file_uid, f.name, f.category_name, f.folder_path, f.created_at
  from folderit_hr_category_files f, words
  where not exists (
    select 1 from unnest(words.w) word
    where f.name not ilike '%' || word || '%'
  )
  union all
  select f.file_uid, f.name, null::text as category_name, null::text as folder_path, f.created_at
  from folderit_inbox_files f
  join folderit_account_map am on am.account_uid = f.account_uid, words
  where am.is_active and am.scope = 'global'
    and not exists (
      select 1 from unnest(words.w) word
      where f.name not ilike '%' || word || '%'
    )
  order by name
  limit 200
$$;

create or replace function public.search_folderit_inbox(p_query text, p_company_uuid uuid)
returns table(file_uid text, name text, account_name text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  with words as (
    select array_remove(string_to_array(trim(p_query), ' '), '') as w
  )
  select distinct f.file_uid, f.name, am.account_name, f.created_at
  from folderit_inbox_files f
  join folderit_account_map am on am.account_uid = f.account_uid, words
  where am.is_active
    and not exists (
      select 1 from unnest(words.w) word
      where f.name not ilike '%' || word || '%'
    )
    and exists (
      select 1 from folderit_account_companies ac
      where ac.account_uid = f.account_uid
        and (p_company_uuid is null or ac.company_uuid = p_company_uuid)
    )
  order by f.name
  limit 200
$$;
