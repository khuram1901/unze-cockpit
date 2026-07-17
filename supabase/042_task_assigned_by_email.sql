-- Migration 042: Add assigned_by_email to tasks for ownership enforcement
-- Tasks created by Admin/CEO/PA are protected — assignees cannot edit or delete them.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_by_email text;

-- Backfill from members table where possible
UPDATE tasks t
SET assigned_by_email = m.email
FROM members m
WHERE t.assigned_by = m.name
  AND t.assigned_by_email IS NULL;
