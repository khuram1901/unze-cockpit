-- 236: Helper for source-document duplicate cleanup
-- Returns paths of all but the newest file per (doc_type / company_id / date_folder).
-- Called by POST /api/admin/cleanup-source-docs in batches of 200.

create or replace function public.find_source_doc_duplicates(p_limit int default 200)
returns table(name text)
language sql
security definer
set search_path = public, storage
as $$
  with ranked as (
    select
      o.name,
      split_part(o.name, '/', 1) as doc_type,
      split_part(o.name, '/', 2) as company_id,
      split_part(o.name, '/', 3) as date_folder,
      o.created_at,
      row_number() over (
        partition by
          split_part(o.name, '/', 1),
          split_part(o.name, '/', 2),
          split_part(o.name, '/', 3)
        order by o.created_at desc
      ) as rn
    from storage.objects o
    where o.bucket_id = 'source-documents'
  )
  select r.name
  from ranked r
  where r.rn > 1
  limit p_limit;
$$;

revoke execute on function public.find_source_doc_duplicates(int) from public, anon, authenticated;
grant execute on function public.find_source_doc_duplicates(int) to service_role;
