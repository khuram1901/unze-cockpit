-- Migration 207 — Deduplicate bell exception_count
-- Apply via Supabase SQL Editor.
--
-- Bug fixed: a task that is both overdue (due_date < today) AND has
-- explanation_required=true was counted in BOTH overdue_count AND exception_count,
-- inflating the bell badge total.
--
-- Fix: exception_count now only counts tasks where due_date IS NULL or due_date >= today,
-- so a task is counted in at most one category.

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

    -- Only count explanation_required tasks that are NOT already in overdue_count.
    -- A task that is both overdue AND needs an explanation belongs in overdue_count only.
    (
      SELECT count(*) FROM tasks
      WHERE assigned_to_email = ANY(p_emails)
        AND status NOT IN ('Completed', 'Cancelled')
        AND explanation_required = true
        AND (due_date IS NULL OR due_date >= p_today)
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
