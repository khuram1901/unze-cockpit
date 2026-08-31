-- 237: Clear document_archive index — PDF archival discontinued.
truncate table public.document_archive;
drop function if exists public.find_source_doc_duplicates(int);
