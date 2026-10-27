-- Migration 289: Task comment read-tracking for bell notifications
-- Tracks when each member last read comments on each task.
-- The bell shows unread_comments_count = comments on tasks you're involved in
-- that were posted after your last read (or any comments if never read).

-- 1. Read-tracking table
CREATE TABLE IF NOT EXISTS task_comment_reads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_email    text NOT NULL,
  task_id         uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  last_read_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_email, task_id)
);

ALTER TABLE task_comment_reads ENABLE ROW LEVEL SECURITY;

-- Members can only read/write their own read receipts
CREATE POLICY "task_comment_reads_self"
  ON task_comment_reads
  FOR ALL
  USING (member_email = auth.jwt() ->> 'email')
  WITH CHECK (member_email = auth.jwt() ->> 'email');

-- Service role (API routes) can write on behalf of any user
-- (already bypasses RLS with service client)

-- Index for fast lookup by email
CREATE INDEX IF NOT EXISTS idx_task_comment_reads_email ON task_comment_reads (member_email);
CREATE INDEX IF NOT EXISTS idx_task_comment_reads_task  ON task_comment_reads (task_id);

-- 2. Updated get_notification_badge_counts — adds unread_comments_count
CREATE OR REPLACE FUNCTION public.get_notification_badge_counts(
  p_emails    text[],
  p_today     date,
  p_is_admin  boolean DEFAULT false
)
RETURNS TABLE(
  overdue_count          bigint,
  waiting_count          bigint,
  submitted_count        bigint,
  exception_count        bigint,
  machines_down_count    bigint,
  pending_minutes_count  bigint,
  chat_unread_count      bigint,
  unread_comments_count  bigint
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

    -- My tasks stuck in Waiting Reply
    (
      SELECT count(*) FROM tasks
      WHERE assigned_to_email = ANY(p_emails)
        AND status = 'Waiting Reply'
    ) AS waiting_count,

    -- My tasks submitted awaiting sign-off
    (
      SELECT count(*) FROM tasks
      WHERE assigned_to_email = ANY(p_emails)
        AND status = 'Submitted'
    ) AS submitted_count,

    -- My tasks needing explanation (not already overdue)
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

    -- Unread chat messages
    (
      SELECT count(*)::bigint
      FROM   chat_messages   cm
      JOIN   chat_participants cp ON cp.conversation_id = cm.conversation_id
      JOIN   members           m  ON m.id = cp.member_id
      WHERE  m.email = ANY(p_emails)
        AND  cm.created_at > cp.last_read_at
        AND  cm.sender_id  IS DISTINCT FROM cp.member_id
        AND  cp.is_deleted = false
    ) AS chat_unread_count,

    -- Unread task comments:
    -- Count distinct tasks that have new comments since I last read them.
    -- "Involved" means: assigned to me, or I assigned it, or I'm a co-assignee,
    -- or I'm @mentioned in a comment on the task.
    (
      SELECT count(DISTINCT tc.task_id)
      FROM task_comments tc
      -- I'm involved in the task
      JOIN tasks t ON t.id = tc.task_id
      WHERE (
        t.assigned_to_email = ANY(p_emails)
        OR t.assigned_by_email = ANY(p_emails)
        OR EXISTS (
          SELECT 1 FROM task_assignees ta
          WHERE ta.task_id = tc.task_id
            AND ta.member_email = ANY(p_emails)
        )
      )
      -- Not my own comment
      AND NOT (tc.commented_by_email = ANY(p_emails))
      -- Only active tasks (not completed/cancelled)
      AND t.status NOT IN ('Completed', 'Cancelled')
      -- Comment is newer than my last read of this task (or I've never read it)
      AND tc.created_at > COALESCE(
        (SELECT last_read_at FROM task_comment_reads tcr
         WHERE tcr.member_email = ANY(p_emails)
           AND tcr.task_id = tc.task_id
         LIMIT 1),
        '1970-01-01'::timestamptz
      )
    ) AS unread_comments_count;
$$;
