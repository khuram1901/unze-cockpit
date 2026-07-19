-- Migration 178: folderit_health_issues
-- Stores results of the daily filing health audit.
-- On every sync run, all issues for the scanned accounts are replaced
-- wholesale — a file that no longer has an issue simply won't appear.
--
-- issue_type values:
--   inbox_subfolder   — a subfolder exists inside the Inbox (structural problem)
--   buried_in_inbox   — a file is inside an Inbox subfolder (should be in main folders)
--   inbox_stale       — a file has been sitting in Inbox root for >2 days without action
--   bad_filename      — filename is generic: scan, IMG_, copy of, document(3), etc.

CREATE TABLE IF NOT EXISTS folderit_health_issues (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  account_uid   text        NOT NULL,
  company_uuid  uuid        REFERENCES companies(id),
  file_uid      text,                        -- null for folder-level issues (inbox_subfolder)
  file_name     text        NOT NULL,
  issue_type    text        NOT NULL,        -- see above
  location_path text,                        -- e.g. "Inbox / Supplier Docs/"
  days_old      int,                         -- days since file created_at
  detected_at   timestamptz DEFAULT now()    -- set on each scan run
);

CREATE INDEX IF NOT EXISTS fhi_account_idx  ON folderit_health_issues (account_uid);
CREATE INDEX IF NOT EXISTS fhi_company_idx  ON folderit_health_issues (company_uuid);
CREATE INDEX IF NOT EXISTS fhi_type_idx     ON folderit_health_issues (issue_type);
CREATE INDEX IF NOT EXISTS fhi_detected_idx ON folderit_health_issues (detected_at DESC);

-- Add health_issues_scanned counter to the sync log
ALTER TABLE public.folderit_sync_log
  ADD COLUMN IF NOT EXISTS health_issues_found int NOT NULL DEFAULT 0;
