-- Migration 290: get_comments_inbox RPC for the Comments Inbox panel
-- Returns tasks with unread comments for the requesting user.
-- Each row includes a JSON array of the unread comments on that task.
-- task.description is the task name column (not title).

DROP FUNCTION IF EXISTS public.get_comments_inbox(text);

CREATE OR REPLACE FUNCTION public.get_comments_inbox(p_email text)
RETURNS TABLE(
  task_id         uuid,
  task_title      text,
  task_status     text,
  last_comment_at timestamptz,
  comments        jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id                        AS task_id,
    t.description               AS task_title,
    t.status                    AS task_status,
    MAX(tc.created_at)          AS last_comment_at,
    jsonb_agg(
      jsonb_build_object(
        'id',                   tc.id,
        'comment_text',         tc.comment_text,
        'commented_by',         tc.commented_by,
        'commented_by_email',   tc.commented_by_email,
        'created_at',           tc.created_at
      ) ORDER BY tc.created_at ASC
    )                           AS comments
  FROM tasks t
  JOIN task_comments tc ON tc.task_id = t.id
  LEFT JOIN task_comment_reads tcr
         ON tcr.task_id = t.id
        AND tcr.member_email = lower(p_email)
  WHERE
    (
      t.assigned_to_email = lower(p_email)
      OR t.assigned_by_email = lower(p_email)
      OR EXISTS (
        SELECT 1 FROM task_assignees ta
        WHERE ta.task_id = t.id AND ta.member_email = lower(p_email)
      )
    )
    AND tc.commented_by_email != lower(p_email)
    AND t.status NOT IN ('Completed', 'Cancelled')
    AND tc.created_at > COALESCE(tcr.last_read_at, '1970-01-01'::timestamptz)
  GROUP BY t.id, t.description, t.status
  ORDER BY MAX(tc.created_at) DESC
  LIMIT 30;
$$;
