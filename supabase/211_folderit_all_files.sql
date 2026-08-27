-- Migration 211: folderit_all_files
-- Full index of EVERY file in every Folderit cabinet, refreshed by the
-- /api/folderit/sync-files cron (every 30 minutes). Replaced wholesale
-- per account on each run.
--
-- Why: (1) global search was calling Folderit's undocumented search API
-- and silently finding nothing — searching this table with ILIKE is
-- instant and reliable; (2) the Browse tab's "All Files" flat view reads
-- straight from here instead of walking the folder tree live on every
-- click. All aggregation in the database, per the project speed rule.

CREATE TABLE IF NOT EXISTS folderit_all_files (
  id                 uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  account_uid        text        NOT NULL,
  file_uid           text        NOT NULL UNIQUE,
  name               text        NOT NULL,
  folder_path        text,                     -- " / "-joined breadcrumb, null = cabinet root
  size_bytes         bigint,
  created_at_folderit timestamptz,             -- file's own creation time in Folderit
  synced_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS faf_account_idx ON folderit_all_files (account_uid);
CREATE INDEX IF NOT EXISTS faf_name_idx    ON folderit_all_files (lower(name));

ALTER TABLE folderit_all_files ENABLE ROW LEVEL SECURITY;
-- No policies: only the service-role client (API routes) reads/writes.

-- Track the file-index sync in its own log columns
ALTER TABLE public.folderit_sync_log
  ADD COLUMN IF NOT EXISTS all_files_synced int NOT NULL DEFAULT 0;
