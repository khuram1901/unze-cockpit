-- Migration 047: Source document archive
-- Indexes original PDFs (cash flow, bank position, future stock/budget docs)
-- stored in the "source-documents" Storage bucket, so parsed figures can
-- always be traced back to and re-derived from the original file.

create table if not exists document_archive (
  id              uuid primary key default gen_random_uuid(),
  doc_type        text not null,         -- 'cash_flow', 'bank_position', etc.
  company_id      uuid references companies(id),
  position_date   date,
  storage_path    text not null,         -- path within the source-documents bucket
  original_filename text not null,
  source          text not null default 'manual',  -- 'manual', 'gmail-auto'
  uploaded_by     text,
  created_at      timestamptz default now()
);

create index if not exists document_archive_lookup
  on document_archive (doc_type, company_id, position_date);

alter table document_archive enable row level security;

-- Service role (cron/API routes) does all writes
create policy "document_archive_service"
  on document_archive for all
  to service_role
  using (true)
  with check (true);

-- Admin only can read the index (download links are signed URLs, generated
-- server-side). This spans finance/investment source documents, so it
-- follows the stricter Admin-only pattern (see holdings_admin_read in 038),
-- not the broader is_admin_or_exec() used for general operational tables.
create policy "document_archive_admin_read"
  on document_archive for select
  to authenticated
  using (
    auth.email() in ('khuram1901@gmail.com', 'k.saleem@unzegroup.com')
    or get_user_role() = 'Admin'
  );
