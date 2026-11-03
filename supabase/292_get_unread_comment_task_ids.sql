-- RPC: get_unread_comment_task_ids
-- Returns task IDs with unread comments for the given array of emails.
-- Used by the Tasks page to show a red dot on tasks with unread comments.
CREATE OR REPLACE FUNCTION get_unread_comment_task_ids(p_emails text[])
RETURNS TABLE(task_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT tc.task_id
  FROM task_comments tc
  JOIN tasks t ON t.id = tc.task_id
  LEFT JOIN (
    SELECT task_id, MAX(last_read_at) AS last_read_at
    FROM task_comment_reads
    WHERE member_email = ANY(p_emails)
    GROUP BY task_id
  ) tcr ON tcr.task_id = tc.task_id
  WHERE
    (
      t.assigned_to_email = ANY(p_emails)
      OR t.assigned_by_email = ANY(p_emails)
      OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = tc.task_id AND ta.member_email = ANY(p_emails))
    )
    AND tc.commented_by_email != ALL(p_emails)
    AND t.status NOT IN ('Completed', 'Cancelled')
    AND tc.created_at > COALESCE(tcr.last_read_at, '1970-01-01'::timestamptz);
$$;
