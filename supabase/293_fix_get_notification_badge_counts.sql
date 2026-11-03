-- Migration 293: Fix get_notification_badge_counts to use MAX(last_read_at) grouped by task_id
-- instead of LIMIT 1, which picked an arbitrary row for dual-identity users (Khuram has two
-- emails: k.saleem@unzegroup.com and khuram1901@gmail.com — both rows exist in task_comment_reads
-- per task, and LIMIT 1 without ORDER BY could return the stale row, making a task appear
-- unread/read incorrectly).

CREATE OR REPLACE FUNCTION public.get_notification_badge_counts(
  p_emails text[],
  p_today date,
  p_is_admin boolean DEFAULT false
)
RETURNS TABLE(
  overdue_count bigint,
  waiting_count bigint,
  submitted_count bigint,
  exception_count bigint,
  machines_down_count bigint,
  pending_minutes_count bigint,
  chat_unread_count bigint,
  unread_comments_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (SELECT count(*) FROM tasks WHERE assigned_to_email = ANY(p_emails) AND status NOT IN ('Completed','Cancelled') AND due_date IS NOT NULL AND due_date < p_today) AS overdue_count,
    (SELECT count(*) FROM tasks WHERE assigned_to_email = ANY(p_emails) AND status = 'Waiting Reply') AS waiting_count,
    (SELECT count(*) FROM tasks WHERE assigned_to_email = ANY(p_emails) AND status = 'Submitted') AS submitted_count,
    (SELECT count(*) FROM tasks WHERE assigned_to_email = ANY(p_emails) AND status NOT IN ('Completed','Cancelled') AND explanation_required = true AND (due_date IS NULL OR due_date >= p_today)) AS exception_count,
    CASE WHEN p_is_admin THEN (SELECT count(*) FROM machine_issues WHERE issue_status = 'Down') ELSE 0 END AS machines_down_count,
    CASE WHEN p_is_admin THEN (SELECT count(*) FROM pending_minutes WHERE status = 'pending') ELSE 0 END AS pending_minutes_count,
    (SELECT count(*)::bigint FROM chat_messages cm JOIN chat_participants cp ON cp.conversation_id = cm.conversation_id JOIN members m ON m.id = cp.member_id WHERE m.email = ANY(p_emails) AND cm.created_at > cp.last_read_at AND cm.sender_id IS DISTINCT FROM cp.member_id AND cp.is_deleted = false) AS chat_unread_count,
    -- Fixed: use MAX(last_read_at) grouped by task_id instead of LIMIT 1 (which picks an arbitrary row for dual-identity users)
    (SELECT count(DISTINCT tc.task_id)
     FROM task_comments tc
     JOIN tasks t ON t.id = tc.task_id
     LEFT JOIN (
       SELECT task_id, MAX(last_read_at) AS last_read_at
       FROM task_comment_reads
       WHERE member_email = ANY(p_emails)
       GROUP BY task_id
     ) tcr ON tcr.task_id = tc.task_id
     WHERE (t.assigned_to_email = ANY(p_emails) OR t.assigned_by_email = ANY(p_emails)
       OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = tc.task_id AND ta.member_email = ANY(p_emails)))
       AND NOT (tc.commented_by_email = ANY(p_emails))
       AND t.status NOT IN ('Completed','Cancelled')
       AND tc.created_at > COALESCE(tcr.last_read_at, '1970-01-01'::timestamptz)
    ) AS unread_comments_count;
$$;
