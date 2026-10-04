import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../../../../../lib/api-auth";
import { createServiceClient } from "../../../../../lib/supabase-server";
import { notifySubtaskSubmitted, notifySubtaskApproved } from "../../../../../lib/task-notifications";

// PATCH /api/tasks/[id]/subtasks/[subtaskId]
// body: { action: "submit" | "approve" }
//
// submit  — caller must be the subtask's assignee (task_subtask_assignees.member_email)
//            Moves status: Not Started → Submitted
//            Notifies whoever assigned this subtask (assigned_by_email on that row)
//
// approve — caller must be the subtask assigner, main task creator, or admin-tier
//            Moves status: Submitted → Completed (trigger syncs is_complete = true)
//            Notifies the subtask assignee

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; subtaskId: string }> }
) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: taskId, subtaskId } = await params;
  const callerEmail: string = (auth as { email: string }).email;

  let body: { action?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { action } = body;
  if (!action || !["submit", "approve"].includes(action)) {
    return NextResponse.json({ error: "action must be 'submit' or 'approve'" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // ── 1. Load parent task ───────────────────────────────────────────────
  const { data: task } = await supabase
    .from("tasks")
    .select("id, status, assigned_to_email, assigned_by_email")
    .eq("id", taskId)
    .maybeSingle();

  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (task.status === "Completed") {
    return NextResponse.json({ error: "Parent task is Completed — subtasks are locked." }, { status: 403 });
  }

  // ── 2. Load subtask ───────────────────────────────────────────────────
  const { data: subtask } = await supabase
    .from("task_subtasks")
    .select("id, title, status, task_id")
    .eq("id", subtaskId)
    .eq("task_id", taskId)
    .maybeSingle();

  if (!subtask) return NextResponse.json({ error: "Subtask not found" }, { status: 404 });

  // ── 3. Load subtask assignee row (if any) ─────────────────────────────
  const { data: assigneeRow } = await supabase
    .from("task_subtask_assignees")
    .select("member_email, member_name, assigned_by_email")
    .eq("subtask_id", subtaskId)
    .eq("task_id", taskId)
    .maybeSingle();

  // ── SUBMIT ────────────────────────────────────────────────────────────
  if (action === "submit") {
    if (subtask.status !== "Not Started") {
      return NextResponse.json(
        { error: `Subtask is already '${subtask.status}' — cannot submit again.` },
        { status: 409 }
      );
    }

    const isSubtaskAssignee = assigneeRow?.member_email?.toLowerCase() === callerEmail.toLowerCase();
    const isTaskAssignee = task.assigned_to_email?.toLowerCase() === callerEmail.toLowerCase();
    if (!isSubtaskAssignee && !isTaskAssignee) {
      return NextResponse.json(
        { error: "Only the person assigned to this subtask can submit it." },
        { status: 403 }
      );
    }

    const { error: updateErr } = await supabase
      .from("task_subtasks")
      .update({ status: "Submitted", submitted_at: new Date().toISOString(), submitted_by_email: callerEmail })
      .eq("id", subtaskId);

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    const notifyEmail = assigneeRow?.assigned_by_email ?? task.assigned_by_email;
    if (notifyEmail && notifyEmail.toLowerCase() !== callerEmail.toLowerCase()) {
      try {
        await notifySubtaskSubmitted(supabase, taskId, subtaskId, notifyEmail, callerEmail);
      } catch (e) {
        console.error("[subtask submit] notification failed (non-fatal):", e);
      }
    }

    return NextResponse.json({ ok: true, status: "Submitted" });
  }

  // ── APPROVE ───────────────────────────────────────────────────────────
  if (action === "approve") {
    if (subtask.status !== "Submitted") {
      return NextResponse.json(
        { error: `Subtask is '${subtask.status}', not 'Submitted' — nothing to approve.` },
        { status: 409 }
      );
    }

    const isSubtaskAssigner = assigneeRow?.assigned_by_email?.toLowerCase() === callerEmail.toLowerCase();
    const isTaskCreator = task.assigned_by_email?.toLowerCase() === callerEmail.toLowerCase();

    let isAdmin = false;
    if (!isSubtaskAssigner && !isTaskCreator) {
      const { data: memberRow } = await supabase
        .from("members")
        .select("role")
        .eq("email", callerEmail)
        .maybeSingle();
      const adminRoles = ["CEO", "HOD", "PA", "Finance"];
      isAdmin = !!(memberRow?.role && adminRoles.includes(memberRow.role));
    }

    if (!isSubtaskAssigner && !isTaskCreator && !isAdmin) {
      return NextResponse.json(
        { error: "Only the person who assigned this subtask (or an admin) can mark it complete." },
        { status: 403 }
      );
    }

    const { error: updateErr } = await supabase
      .from("task_subtasks")
      .update({ status: "Completed" })
      .eq("id", subtaskId);

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    const notifyEmail = assigneeRow?.member_email ?? task.assigned_to_email;
    if (notifyEmail && notifyEmail.toLowerCase() !== callerEmail.toLowerCase()) {
      try {
        await notifySubtaskApproved(supabase, taskId, subtaskId, notifyEmail);
      } catch (e) {
        console.error("[subtask approve] notification failed (non-fatal):", e);
      }
    }

    return NextResponse.json({ ok: true, status: "Completed" });
  }
}
