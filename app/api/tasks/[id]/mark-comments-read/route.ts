import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../../../../lib/api-auth";
import { createServiceClient } from "../../../../lib/supabase-server";

// POST /api/tasks/[id]/mark-comments-read
// Called when a user opens a task detail panel.
// Upserts a row in task_comment_reads so the bell count drops to 0 for this task.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: taskId } = await params;
  const userEmail = auth.email;

  if (!userEmail) {
    return NextResponse.json({ error: "No email on session" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { error } = await supabase
    .from("task_comment_reads")
    .upsert(
      { member_email: userEmail.toLowerCase(), task_id: taskId, last_read_at: new Date().toISOString() },
      { onConflict: "member_email,task_id" }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
