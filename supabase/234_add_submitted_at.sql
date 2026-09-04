-- Migration 234: Add submitted_at timestamp to tasks
-- Records when the employee submitted the task, independent of when the manager approved it.
-- This lets performance scoring use the employee's submission time, not the manager's approval time.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz DEFAULT NULL;

-- Auto-stamp submitted_at whenever status changes TO 'Submitted'.
-- Always updates on re-submission so we track the latest attempt.
CREATE OR REPLACE FUNCTION public.stamp_submitted_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'Submitted' AND (OLD.status IS DISTINCT FROM 'Submitted') THEN
    NEW.submitted_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_submitted_at ON public.tasks;
CREATE TRIGGER trg_stamp_submitted_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.stamp_submitted_at();
