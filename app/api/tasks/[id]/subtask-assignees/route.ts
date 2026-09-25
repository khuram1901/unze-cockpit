import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../../../../lib/api-auth";
import { createServiceClient } from "../../../../lib/supabase-server";
import { notifyTaskAssigned } from "../../../../lib/task-notifications";

// POST  /api/tasks/[id]/subtask-assignees — assign a member to a subtask
// DELETE /api/tasks/[id]/subtask-assignees — unassign a member from a subtask
//
// Both routes:
//   1. Require auth
//   2. Block if parent task is Completed
//   3. Require caller to be creator, primary assignee, main-task co-assignee, or admin-tier
//   4. Use service client for writes (DB triggers enforce the Completed lock
//      and referential integrity as a second defence layer)
//
// POST also:
//   5. Validates subtask belongs to task before writing
//   6. Upserts visibility row in task_assignees with assigned_via='subtask'
//      (skipped if they already have a 'main_task' row — do not downgrade)
//   7. Sends notifyTaskAssigned if assigning someone other than yourself
//
// DELETE also:
//   5. After removing from task_subtask_assignees, checks if the member
//      has any remaining subtask on this task. If not, removes the
//      task_assignees row only when assigned_via='subtask'.

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const taskId = params.id;
  const callerEmail: string = (auth as { email: string }).email;

  let body: { subtaskId?: string; memberEmail?: string; memberName?: string; memberId?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { subtaskId, memberEmail, memberName, memberId } = body;
  if (!subtaskId || !memberEmail || !memberName) {
    return NextResponse.json({ error: "subtaskId, memberEmail and memberName are required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // ── 1. Load parent task ───────────────────────────────────────────────
  const { data: task, error: taskErr } = await supabase
    .from("tasks")
    .select("id, status, assigned_to_email, assigned_by_email")
    .eq("id", taskId)
    .maybeSingle();

  if (taskErr || !task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  // ── 2. Block on Completed ─────────────────────────────────────────────
  if (task.status === "Completed") {
    return NextResponse.json({ error: "Cannot change subtask assignees on a Completed task." }, { status: 403 });
  }

  // ── 3. Permission check ───────────────────────────────────────────────
  const canManage = await callerCanManageSubtaskAssignees(supabase, taskId, callerEmail, task.assigned_to_email, task.assigned_by_email);
  if (!canManage) {
    return NextResponse.json({ error: "You don't have permission to manage subtask assignees for this task." }, { status: 403 });
  }

  // ── 4. Validate subtask belongs to task ──────────────────────────────
  const { data: subtask } = await supabase
    .from("task_subtasks")
    .select("id")
    .eq("id", subtaskId)
    .eq("task_id", taskId)
    .maybeSingle();
  if (!subtask) return NextResponse.json({ error: "Subtask not found on this task" }, { status: 404 });

  // ── 5. Insert into task_subtask_assignees ─────────────────────────────
  const { error: insertErr } = await supabase.from("task_subtask_assignees").insert({
    subtask_id: subtaskId,
    task_id: taskId,
    member_id: memberId || null,
    member_name: memberName,
    member_email: memberEmail,
    assigned_by_email: callerEmail,
  });
  if (insertErr) {
    // Duplicate (already assigned to this subtask) is not an error we surface as 500
    if (insertErr.code === "23505") return NextResponse.json({ ok: true, skipped: "already assigned" });
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // ── 6. Upsert visibility row in task_assignees ────────────────────────
  // Only insert if no row exists. If a 'main_task' row exists, do nothing
  // (do not downgrade). If no row exists, insert as 'subtask'.
  const { data: existingRow } = await supabase
    .from("task_assignees")
    .select("id, assigned_via")
    .eq("task_id", taskId)
    .eq("member_email", memberEmail)
    .maybeSingle();

  if (!existingRow) {
    await supabase.from("task_assignees").insert({
      task_id: taskId,
      member_id: memberId || null,
      member_name: memberName,
      member_email: memberEmail,
      assigned_via: "subtask",
    });
    // Ignore error — visibility row is best-effort; the task_subtask_assignees row is the source of truth
  }
  // If existingRow exists (either 'main_task' or 'subtask'), leave it as-is.

  // ── 7. Notification ───────────────────────────────────────────────────
  if (memberEmail.toLowerCase() !== callerEmail.toLowerCase()) {
    try {
      await notifyTaskAssigned(supabase, taskId, memberEmail);
    } catch (e) {
      console.error("Subtask assignee notified failed (non-fatal):", taskId, memberEmail, e);
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const taskId = params.id;
  const callerEmail: string = (auth as { email: string }).email;

  let body: { subtaskId?: string; memberEmail?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { subtaskId, memberEmail } = body;
  if (!subtaskId || !memberEmail) {
    return NextResponse.json({ error: "subtaskId and memberEmail are required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // ── 1. Load parent task ───────────────────────────────────────────────
  const { data: task } = await supabase
    .from("tasks")
    .select("id, status, assigned_to_email, assigned_by_email")
    .eq("id", taskId)
    .maybeSingle();

  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  // ── 2. Block on Completed ─────────────────────────────────────────────
  if (task.status === "Completed") {
    return NextResponse.json({ error: "Cannot change subtask assignees on a Completed task." }, { status: 403 });
  }

  // ── 3. Permission check ───────────────────────────────────────────────
  const canManage = await callerCanManageSubtaskAssignees(supabase, taskId, callerEmail, task.assigned_to_email, task.assigned_by_email);
  if (!canManage) {
    return NextResponse.json({ error: "You don't have permission to manage subtask assignees for this task." }, { status: 403 });
  }

  // ── 4. Remove from task_subtask_assignees ─────────────────────────────
  const { error: deleteErr } = await supabase
    .from("task_subtask_assignees")
    .delete()
    .eq("subtask_id", subtaskId)
    .eq("task_id", taskId)
    .eq("member_email", memberEmail);

  if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });

  // ── 5. Remove visibility row if no other subtask assignments remain ────
  const { data: remaining } = await supabase
    .from("task_subtask_assignees")
    .select("id")
    .eq("task_id", taskId)
    .eq("member_email", memberEmail)
    .limit(1);

  if (!remaining || remaining.length === 0) {
    // No other subtask assignments — safe to remove the visibility row,
    // but only if it was added as 'subtask' (not a main-task co-owner)
    await supabase
      .from("task_assignees")
      .delete()
      .eq("task_id", taskId)
      .eq("member_email", memberEmail)
      .eq("assigned_via", "subtask");
  }

  return NextResponse.json({ ok: true });
}

// ── Helper: can the caller manage subtask assignees on this task? ─────────
// Allowed: admin-tier (can_access_all_tasks), task creator, primary assignee,
// or a main-task co-assignee. Subtask-only assignees are NOT included.
async function callerCanManageSubtaskAssignees(
  supabase: ReturnType<typeof createServiceClient>,
  taskId: string,
  callerEmail: string,
  assignedToEmail: string | null,
  assignedByEmail: string | null,
): Promise<boolean> {
  // Primary assignee
  if (assignedToEmail?.toLowerCase() === callerEmail.toLowerCase()) return true;
  // Creator
  if (assignedByEmail?.toLowerCase() === callerEmail.toLowerCase()) return true;

  // Check admin-tier or main-task co-assignee in one query
  const { data: memberRow } = await supabase
    .from("members")
    .select("role")
    .eq("email", callerEmail)
    .maybeSingle();

  const adminRoles = ["CEO", "HOD", "PA", "Finance"];
  if (memberRow?.role && adminRoles.includes(memberRow.role)) return true;

  // Main-task co-assignee (assigned_via='main_task')
  const { data: assigneeRow } = await supabase
    .from("task_assignees")
    .select("id")
    .eq("task_id", taskId)
    .eq("member_email", callerEmail)
    .eq("assigned_via", "main_task")
    .maybeSingle();

  return !!assigneeRow;
}
