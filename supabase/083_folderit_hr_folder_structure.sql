-- ============================================================
-- 083: Preserve Folderit's real folder structure for HR documents
--
-- Khuram: "with regards to HR its now a new issue, i can see all 600 +
-- documents but they arent organsied like they are in folder it. We need
-- to show the same map/directory so users dont find it difficult in
-- navigating."
--
-- The recursive HR sync (fetchFolderFilesRecursive in
-- app/api/folderit/sync/route.ts) always walked Folderit's subfolders
-- correctly, but discarded the folder path once it found the files —
-- everything landed in one flat table with no record of which subfolder
-- (e.g. "01-Archive", "02-Policies & SOPs") a file came from. This adds a
-- folder_path column so the sync route can record it, and updates the
-- detail RPC to return it so the frontend can group files back into the
-- same folders Khuram sees inside Folderit itself.
--
-- folder_path is null for files sitting directly in the category's root
-- folder, and a "/"-joined breadcrumb (e.g. "01-Archive/2019") for files
-- inside subfolders.
-- ============================================================

alter table folderit_hr_category_files
  add column if not exists folder_path text;

drop function if exists get_folderit_hr_category_files(text);

create or replace function get_folderit_hr_category_files(p_category_name text)
returns table (
  file_uid    text,
  name        text,
  folder_path text,
  created_at  timestamptz
)
language sql
security definer
set search_path = public
as $$
  select file_uid, name, folder_path, created_at
  from folderit_hr_category_files
  where category_name = p_category_name
  order by folder_path nulls first, name
$$;
