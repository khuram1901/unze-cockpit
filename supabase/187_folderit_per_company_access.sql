-- Migration 187: Per-company Folderit access controls
--
-- Replaces the single "can_view_folderit_hr" toggle (HR documents only) with
-- a full per-company cabinet access model. Each column grants a user access
-- to view a specific company's Folderit inbox and document breakdown.
--
-- RST = Restaurant (merged display of Baranh + Haute Dolci in the UI — both
-- underlying cabinets are shown when this flag is true).
-- DIR = Directors / Family Documents (the cabinet Folderit calls "Directors").
--
-- Default (NULL) = no access for non-admin users.
-- Admin / CEO always sees all companies regardless of these flags (the page
-- falls through to isAdminTier() before checking overrides).
--
-- Apply via: Supabase Dashboard → SQL Editor → run this file.

ALTER TABLE member_permissions
  ADD COLUMN IF NOT EXISTS folderit_can_view_utpl BOOLEAN,
  ADD COLUMN IF NOT EXISTS folderit_can_view_ifpl BOOLEAN,
  ADD COLUMN IF NOT EXISTS folderit_can_view_rst  BOOLEAN,
  ADD COLUMN IF NOT EXISTS folderit_can_view_smi  BOOLEAN,
  ADD COLUMN IF NOT EXISTS folderit_can_view_uzl  BOOLEAN,
  ADD COLUMN IF NOT EXISTS folderit_can_view_dir  BOOLEAN;

-- Verify: show Sultan and Sundas rows
SELECT m.name, m.role,
       mp.can_view_folderit_hr,
       mp.folderit_can_view_utpl,
       mp.folderit_can_view_ifpl,
       mp.folderit_can_view_rst,
       mp.folderit_can_view_smi,
       mp.folderit_can_view_uzl,
       mp.folderit_can_view_dir
FROM   members m
JOIN   member_permissions mp ON mp.member_id = m.id
WHERE  m.name IN ('Muhammad  Sultan', 'Sundas Hussain');
