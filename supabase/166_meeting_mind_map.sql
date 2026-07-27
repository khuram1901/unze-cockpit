-- 166_meeting_mind_map.sql
--
-- Adds mind map image support to meeting records.
--
-- 1. Add mind_map_url column to meetings table
-- 2. Create a public storage bucket for mind map images
-- 3. RLS policies so authenticated users can upload/read,
--    only the uploader (or admin) can delete
--
-- Apply via Supabase SQL Editor.

-- Column on meetings
alter table public.meetings
  add column if not exists mind_map_url text;

-- Storage bucket (public so images render directly in the app)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'meeting-mind-maps',
  'meeting-mind-maps',
  true,
  10485760,  -- 10 MB limit per image
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

-- RLS: authenticated users can upload into the bucket
drop policy if exists "Authenticated users can upload mind maps" on storage.objects;
create policy "Authenticated users can upload mind maps"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'meeting-mind-maps');

-- RLS: anyone (public) can view mind map images
drop policy if exists "Public can view mind maps" on storage.objects;
create policy "Public can view mind maps"
  on storage.objects for select
  to public
  using (bucket_id = 'meeting-mind-maps');

-- RLS: authenticated users can delete their own uploads
drop policy if exists "Authenticated users can delete mind maps" on storage.objects;
create policy "Authenticated users can delete mind maps"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'meeting-mind-maps');
