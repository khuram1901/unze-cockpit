-- Add time tracking to tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS time_spent_minutes integer DEFAULT 0;
