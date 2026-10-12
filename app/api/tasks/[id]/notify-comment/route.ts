import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../../../../lib/api-auth";
import { createServiceClient } from "../../../../lib/supabase-server";
import { sendNotificationEmail } from "../../../../lib/send-email";
import { TRIGGER_TASK_COMMENT } from "../../../../lib/notification-types";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://unze-cockpit.vercel.app";

// POST /api/tasks/[id]/notify-comment
// Called from TaskDetailPanel after a comment is successfully inserted.
// Body: { commenterEmail: string, commenterName: string, commentText: string }
//
// Recipients: assigner (assigned_by_email) + assignee (assigned_to_email)
// + any co-assignees from task_assignees — MINUS the commenter.
// Each recipient must have notify_email=true AND notif_task_comment=true.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: taskId } = await params;
  const body = await request.json().catch(() => ({})) as {
    commenterEmail?: string | null;
    commenterName?: string | null;
    commentText?: string | null;
  };

  const commenterEmail = body.commenterEmail ?? null;
  const commenterName = body.commenterName ?? null;
  const commentText = body.commentText ?? null;

  const supabase = createServiceClient();

  // Fetch the task
  const { data: task } = await supabase
    .from("tasks")
    .select("description, priority, due_date, assigned_to_email, assigned_by_email")
    .eq("id", taskId)
    .maybeSingle();

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Fetch co-assignees
  const { data: coAssignees } = await supabase
    .from("task_assignees")
    .select("member_email")
    .eq("task_id", taskId);

  // Build unique set of recipient emails, excluding the commenter
  const recipientSet = new Set<string>();
  if (task.assigned_to_email) recipientSet.add(task.assigned_to_email.toLowerCase());
  if (task.assigned_by_email) recipientSet.add(task.assigned_by_email.toLowerCase());
  for (const ca of (coAssignees ?? []) as { member_email: string | null }[]) {
    if (ca.member_email) recipientSet.add(ca.member_email.toLowerCase());
  }
  if (commenterEmail) recipientSet.delete(commenterEmail.toLowerCase());

  if (recipientSet.size === 0) {
    return NextResponse.json({ sent: 0, skipped: 0 });
  }

  // Fetch all relevant members in one query
  const { data: members } = await supabase
    .from("members")
    .select("email, first_name, last_name, name, notify_email, notif_task_comment")
    .in("email", Array.from(recipientSet));

  type MemberRow = {
    email: string;
    first_name: string | null;
    last_name: string | null;
    name: string | null;
    notify_email: boolean | null;
    notif_task_comment: boolean | null;
  };

  const memberMap = new Map<string, MemberRow>(
    ((members ?? []) as MemberRow[]).map((m) => [m.email.toLowerCase(), m])
  );

  const taskDesc = task.description ?? "Task";
  const commentPreview = commentText
    ? (commentText.length > 120 ? commentText.slice(0, 120) + "…" : commentText)
    : null;
  const dueDisplay = task.due_date
    ? (task.due_date as string).split("-").reverse().join("/")
    : "No due date";

  let sent = 0;
  let skipped = 0;

  for (const recipientEmail of recipientSet) {
    const member = memberMap.get(recipientEmail);

    if (!member?.notify_email) { skipped++; continue; }
    if (!member?.notif_task_comment) { skipped++; continue; }

    const recipientName =
      `${member.first_name || ""} ${member.last_name || ""}`.trim() ||
      member.name ||
      recipientEmail;

    await sendNotificationEmail({
      to: recipientEmail,
      subject: `[COMMENT] ${taskDesc.slice(0, 55)}`,
      heading: "New Comment on a Task",
      body: `
        <p><strong>${recipientName}</strong>, <strong>${commenterName || commenterEmail || "Someone"}</strong> added a comment on a task you're involved in:</p>
        <p style="background:#f1f5f9;padding:12px;border-radius:6px;border-left:3px solid #2563eb;font-size:13px">
          ${taskDesc}
        </p>
        ${commentPreview ? `
        <p style="background:#f8fafc;padding:10px 12px;border-radius:6px;border:1px solid #e2e8f0;font-size:13px;margin-top:8px">
          "${commentPreview}"
        </p>` : ""}
        <p style="margin-top:8px;font-size:13px"><strong>Due:</strong> ${dueDisplay}</p>
        <p style="font-size:12px;color:#64748b;margin-top:4px">Open the task to read the full comment and reply.</p>
      `,
      linkUrl: `${APP_URL}/tasks`,
      linkLabel: "View Task",
      triggerType: TRIGGER_TASK_COMMENT,
      triggerRecordId: taskId,
      recipientName,
      whatsAppPhone: null,
      whatsAppMessage: undefined,
    });

    sent++;
  }

  return NextResponse.json({ sent, skipped });
}
