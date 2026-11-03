import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";
import { myIdentityEmails } from "../../../lib/permissions";

// GET /api/tasks/unread-comment-ids
// Returns an array of task IDs that have unread comments for the current user.
// Used by the Tasks page to show a red dot on tasks with unread comments.
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const userEmail = auth.email;
  if (!userEmail) {
    return NextResponse.json({ error: "No email on session" }, { status: 400 });
  }

  const emails = myIdentityEmails(userEmail).map(e => e.toLowerCase());
  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc("get_unread_comment_task_ids", {
    p_emails: emails,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ taskIds: (data ?? []).map((r: { task_id: string }) => r.task_id) });
}
