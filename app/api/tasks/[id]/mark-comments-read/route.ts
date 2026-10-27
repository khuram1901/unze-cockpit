import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../../../../lib/api-auth";
import { createServiceClient } from "../../../../lib/supabase-server";
import { myIdentityEmails } from "../../../../lib/permissions";

// POST /api/tasks/[id]/mark-comments-read
// Called when a user opens a task detail panel or the comments inbox.
// Upserts read receipts for ALL identity emails so the bell badge
// drops to 0 even for dual-identity users (e.g. CEO with two emails).
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
  const emails = myIdentityEmails(userEmail).map(e => e.toLowerCase());
  const now = new Date().toISOString();

  for (const em of emails) {
    const { error } = await supabase
      .from("task_comment_reads")
      .upsert(
        { member_email: em, task_id: taskId, last_read_at: now },
        { onConflict: "member_email,task_id" }
      );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
