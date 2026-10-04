-- ============================================================
-- Migration 253: subtask status machine
-- Adds status (Not Started | Submitted | Completed), submitted_at,
-- submitted_by_email to task_subtasks.
-- Existing rows with is_complete=true → status='Completed'.
-- A bidirectional trigger keeps is_complete and status in sync so
-- old code paths that toggle is_complete directly still work.
-- ============================================================

-- 1. New columns
ALTER TABLE task_subtasks
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Not Started'
    CHECK (status IN ('Not Started', 'Submitted', 'Completed')),
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_by_email TEXT;

-- 2. Sync existing completed rows
UPDATE task_subtasks
SET status = 'Completed'
WHERE is_complete = true
  AND status = 'Not Started';

-- 3. Bidirectional sync trigger
CREATE OR REPLACE FUNCTION sync_subtask_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- A) is_complete toggled directly (old code path) → derive status
  IF OLD.is_complete IS DISTINCT FROM NEW.is_complete THEN
    IF NEW.is_complete = true AND NEW.status != 'Completed' THEN
      NEW.status := 'Completed';
      NEW.completed_at := COALESCE(NEW.completed_at, NOW());
    ELSIF NEW.is_complete = false AND NEW.status = 'Completed' THEN
      NEW.status := 'Not Started';
      NEW.completed_at := NULL;
    END IF;
  END IF;

  -- B) status changed (new code path) → derive is_complete
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'Completed' THEN
      NEW.is_complete := true;
      NEW.completed_at := COALESCE(NEW.completed_at, NOW());
    ELSIF NEW.status = 'Not Started' THEN
      NEW.is_complete := false;
      NEW.completed_at := NULL;
    END IF;
    -- 'Submitted' leaves is_complete untouched (still false)
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subtask_status_sync ON task_subtasks;
CREATE TRIGGER subtask_status_sync
  BEFORE UPDATE ON task_subtasks
  FOR EACH ROW EXECUTE FUNCTION sync_subtask_status();
