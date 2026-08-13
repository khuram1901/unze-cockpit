-- Migration 206 — Bell must count unread from archived convs too
-- Apply via Supabase SQL Editor.
--
-- Previous migration 205 incorrectly excluded is_archived=true from the bell
-- count. The correct rule:
--   - is_deleted=true  → excluded (user permanently left that conv)
--   - is_archived=true → INCLUDED (new messages must still ring the bell,
--     and the auto-unarchive in messages/route.ts brings them back to the
--     main list when the user opens the chat panel)

CREATE OR REPLACE FUNCTION public.get_notification_badge_counts(
  p_emails     text[],
  p_today      date,
  p_is_admin   boolean DEFAULT false
)
RETURNS TABLE(
  overdue_count         bigint,
  waiting_count         bigint,
  submitted_count       bigint,
  exception_count       bigint,
  machines_down_count   bigint,
  pending_minutes_count bigint,
  chat_unread_count     bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (
      SELECT count(*) FROM tasks
      WHERE assigned_to_email = ANY(p_emails)
        AND status NOT IN ('Completed', 'Cancelled')
        AND due_date IS NOT NULL
        AND due_date < p_today
    ) AS overdue_count,

    (
      SELECT count(*) FROM tasks
      WHERE assigned_to_email = ANY(p_emails)
        AND status = 'Waiting Reply'
    ) AS waiting_count,

    (
      SELECT count(*) FROM tasks
      WHERE assigned_to_email = ANY(p_emails)
        AND status = 'Submitted'
    ) AS submitted_count,

    (
      SELECT count(*) FROM tasks
      WHERE assigned_to_email = ANY(p_emails)
        AND status NOT IN ('Completed', 'Cancelled')
        AND explanation_required = true
    ) AS exception_count,

    CASE WHEN p_is_admin THEN
      (SELECT count(*) FROM machine_issues WHERE issue_status = 'Down')
    ELSE 0 END AS machines_down_count,

    CASE WHEN p_is_admin THEN
      (SELECT count(*) FROM pending_minutes WHERE status = 'pending')
    ELSE 0 END AS pending_minutes_count,

    -- Unread chat: exclude only is_deleted=true (user permanently left the conv).
    -- is_archived=true convs STILL count — new messages in them ring the bell
    -- and messages/route.ts auto-unarchives them back to the main list.
    (
      SELECT count(*)::bigint
      FROM   chat_messages   cm
      JOIN   chat_participants cp ON cp.conversation_id = cm.conversation_id
      JOIN   members           m  ON m.id = cp.member_id
      WHERE  m.email = ANY(p_emails)
        AND  cm.created_at > cp.last_read_at
        AND  cm.sender_id  IS DISTINCT FROM cp.member_id
        AND  cp.is_deleted = false
    ) AS chat_unread_count;
$$;
