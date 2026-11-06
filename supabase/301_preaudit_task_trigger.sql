-- Migration 301: trigger to sync task completions into preaudit_completions
-- When a task with source_type='preaudit' is marked Completed,
-- auto-record it in preaudit_completions (is_late if completed after due_date).

CREATE OR REPLACE FUNCTION fn_preaudit_task_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id uuid;
BEGIN
  -- Only fire when status flips to Completed on a preaudit task
  IF NEW.status = 'Completed'
     AND (OLD.status IS DISTINCT FROM 'Completed')
     AND NEW.source_type = 'preaudit'
     AND NEW.assigned_to_email IS NOT NULL
     AND NEW.company_id IS NOT NULL
     AND NEW.due_date IS NOT NULL
  THEN
    SELECT id INTO v_member_id
    FROM members
    WHERE email = NEW.assigned_to_email
    LIMIT 1;

    IF v_member_id IS NOT NULL THEN
      INSERT INTO preaudit_completions
        (member_id, company_id, task_date, completed_at, notes)
      VALUES (
        v_member_id,
        NEW.company_id,
        NEW.due_date,
        COALESCE(NEW.completed_at, now()),
        NEW.notes
      )
      ON CONFLICT (member_id, company_id, task_date) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_preaudit_task_completed ON tasks;
CREATE TRIGGER trg_preaudit_task_completed
  AFTER UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION fn_preaudit_task_completed();
