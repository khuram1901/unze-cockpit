-- 176 — Folderit user mapping table
-- Apply in Supabase SQL Editor.
--
-- Stores the match between an app member's email and their Folderit user UID
-- per Folderit account. Populated by the daily sync cron. The file browser
-- and health audit use this to scope what each user can see.

CREATE TABLE IF NOT EXISTS folderit_user_map (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  member_email        text        NOT NULL,
  account_uid         text        NOT NULL,
  folderit_user_uid   text        NOT NULL,
  display_name        text,
  synced_at           timestamptz DEFAULT now(),
  UNIQUE (member_email, account_uid)
);

CREATE INDEX IF NOT EXISTS folderit_user_map_email_idx
  ON folderit_user_map (member_email);

CREATE INDEX IF NOT EXISTS folderit_user_map_account_idx
  ON folderit_user_map (account_uid);

-- Add users_synced column to folderit_sync_log (created in migration 146)
ALTER TABLE public.folderit_sync_log
  ADD COLUMN IF NOT EXISTS users_synced int NOT NULL DEFAULT 0;

-- Verify
SELECT * FROM folderit_user_map ORDER BY member_email;
