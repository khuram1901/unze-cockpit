import { NextRequest } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";
import { createTaskCore, type TaskActor } from "../../../lib/task-creation";
import { rateLimitByIP, rateLimitResponse } from "../../../lib/rate-limit";
import { canCreateAssignments, isPrivileged, type UserCtx, type PermOverrides } from "../../../lib/permissions";

// The one shared entry point for creating a task — every path in the app
// (New Task form, PA quick-add, meeting minutes, CSV import, and the
// cash-escalation auto-task) routes through this instead of inserting
// into `tasks` directly. See TASK_NOTIFICATION_AUDIT.md for why: 7
// independent insert call sites, each populating a different subset of
// fields, was the root cause of the inconsistencies Khuram flagged
// (missing company tags, no character limit, hardcoded "assigned by",
// silent task creation with no notification).
//
// The recurring-task cron does NOT call this route — it's already
// server-side with its own service client, so it calls createTaskCore
// directly (no HTTP round-trip needed).
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const rl = rateLimitByIP(request, 40, 60000);
  if (!rl.allowed) return rateLimitResponse();

  try {
    const body = await request.json();
    const {
      description, companyId, assignedTo, assignedToEmail, assignedToMemberId, additionalAssignees,
      assignedToDepartment, assignedToBusinessUnit, dueDate, priority, status, project, stage, notes,
      taskType, replyRequired, explanationRequired, exceptionType, meetingId,
      sourceType, sourceRecordId, sourceLabel, notificationStyle,
      systemActor,
    } = body || {};

    const supabase = createServiceClient();
    const { data: member } = await supabase
      .from("members")
      .select("id, first_name, last_name, name, role, department")
      .eq("email", auth.email)
      .maybeSingle();

    // Server-side capability check, matching canCreateAssignments() —
    // the same rule that already gates the "+ New Task" button on every
    // page. This route uses the service-role client (bypasses RLS) so it
    // has to re-check this itself; the RLS insert policy on `tasks` alone
    // doesn't restrict who can create one.
    let overrides: PermOverrides | null = null;
    if (member?.id) {
      const { data: perms } = await supabase
        .from("member_permissions")
        .select("*")
        .eq("member_id", member.id)
        .maybeSingle();
      overrides = (perms as PermOverrides) || null;
    }
    const ctx: UserCtx = { email: auth.email, role: member?.role ?? null, department: member?.department ?? null, overrides };
    if (!canCreateAssignments(ctx)) {
      return Response.json({ error: "Not authorised to create tasks" }, { status: 403 });
    }

    let actor: TaskActor;
    if (systemActor) {
      // Only genuinely automated detections (currently: the cash-
      // escalation engine) may claim to be the system rather than the
      // logged-in user — gated on admin/exec/CEO so a regular member
      // can't spoof "assigned by System" on a task they're personally
      // creating.
      if (!isPrivileged(ctx)) {
        return Response.json({ error: "Not authorised to create a system-attributed task" }, { status: 403 });
      }
      actor = { kind: "system", label: typeof systemActor === "string" ? systemActor : "System" };
    } else {
      const name = member
        ? (`${member.first_name || ""} ${member.last_name || ""}`.trim() || member.name || auth.email)
        : auth.email;
      actor = { kind: "user", name, email: auth.email };
    }

    const result = await createTaskCore({
      description, companyId, assignedTo, assignedToEmail, assignedToMemberId, additionalAssignees,
      assignedToDepartment, assignedToBusinessUnit, dueDate, priority, status, project, stage, notes,
      taskType, replyRequired, explanationRequired, exceptionType, meetingId,
      sourceType, sourceRecordId, sourceLabel, notificationStyle, actor,
    });

    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    if (result.skipped) return Response.json({ skipped: true, reason: result.reason });
    return Response.json({ success: true, taskId: result.taskId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
