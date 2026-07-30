-- Migration 205 — Fix chat_unread_count in bell to exclude deleted/archived conversations
-- Apply via Supabase SQL Editor.
-- Previously the bell counted unread messages from ALL conversations including ones
-- the user had deleted or archived, causing a mismatch with the chat panel which
-- only shows active (non-deleted, non-archived) conversations.

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
    -- Overdue tasks assigned to me
    (
      SELECT count(*) FROM tasks
      WHERE assigned_to_email = ANY(p_emails)
        AND status NOT IN ('Completed', 'Cancelled')
        AND due_date IS NOT NULL
        AND due_date < p_today
    ) AS overdue_count,

    -- Tasks waiting for my reply
    (
      SELECT count(*) FROM tasks
      WHERE assigned_to_email = ANY(p_emails)
        AND status = 'Waiting Reply'
    ) AS waiting_count,

    -- Tasks submitted and routed to me for sign-off
    (
      SELECT count(*) FROM tasks
      WHERE assigned_to_email = ANY(p_emails)
        AND status = 'Submitted'
    ) AS submitted_count,

    -- Tasks flagged as needing an explanation
    (
      SELECT count(*) FROM tasks
      WHERE assigned_to_email = ANY(p_emails)
        AND status NOT IN ('Completed', 'Cancelled')
        AND explanation_required = true
    ) AS exception_count,

    -- Machines down (admin only)
    CASE WHEN p_is_admin THEN
      (SELECT count(*) FROM machine_issues WHERE issue_status = 'Down')
    ELSE 0 END AS machines_down_count,

    -- Minutes pending (admin only)
    CASE WHEN p_is_admin THEN
      (SELECT count(*) FROM pending_minutes WHERE status = 'pending')
    ELSE 0 END AS pending_minutes_count,

    -- Unread chat messages — only from active (non-deleted, non-archived) conversations.
    -- Excludes deleted/archived so the bell count always matches what the panel shows.
    (
      SELECT count(*)::bigint
      FROM   chat_messages   cm
      JOIN   chat_participants cp ON cp.conversation_id = cm.conversation_id
      JOIN   members           m  ON m.id = cp.member_id
      WHERE  m.email = ANY(p_emails)
        AND  cm.created_at > cp.last_read_at
        AND  cm.sender_id  IS DISTINCT FROM cp.member_id
        AND  cp.is_deleted = false
        AND  cp.is_archived = false
    ) AS chat_unread_count;
$$;
