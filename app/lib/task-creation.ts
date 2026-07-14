import { createServiceClient } from "./supabase-server";
import { notifyTaskAssigned, notifyEscalationTask } from "./task-notifications";

// Keep in sync with TASK_DESCRIPTION_LIMIT in app/lib/SharedUI.tsx. Not
// imported directly to avoid pulling a "use client" file into server-only
// code — it's a plain number, duplicated deliberately with this comment
// as the tripwire if one side ever changes without the other.
const DESCRIPTION_LIMIT = 150;

export type TaskActor =
  | { kind: "user"; name: string; email: string }
  | { kind: "system"; label: string };

export type CreateTaskInput = {
  description: string;
  companyId: string;
  assignedTo: string;
  assignedToEmail: string | null;
  assignedToDepartment?: string | null;
  assignedToBusinessUnit?: string | null;
  dueDate?: string | null;
  priority?: string;
  status?: string;
  project?: string | null;
  stage?: string | null;
  notes?: string | null;
  taskType?: string;
  replyRequired?: boolean;
  explanationRequired?: boolean;
  exceptionType?: string | null;
  meetingId?: string | null;
  sourceType?: string | null;
  sourceRecordId?: string | null;
  sourceLabel?: string | null;
  actor: TaskActor;
  notificationStyle?: "task_assigned" | "escalation" | "none";
};

export type CreateTaskResult =
  | { ok: true; taskId: string; skipped: false }
  | { ok: true; taskId: null; skipped: true; reason: string }
  | { ok: false; error: string };

// The one gate every task-creation path in the app routes through — built
// to close the inconsistencies documented in TASK_NOTIFICATION_AUDIT.md
// (7 independent insert call sites, each populating a different subset of
// fields). Called from app/api/tasks/create/route.ts (client-facing paths)
// and directly, in-process, from the recurring-task cron (server-side,
// no HTTP round-trip needed there).
export async function createTaskCore(input: CreateTaskInput): Promise<CreateTaskResult> {
  const description = input.description?.trim() || "";
  if (!description) return { ok: false, error: "Description is required." };
  if (description.length > DESCRIPTION_LIMIT) {
    return { ok: false, error: `Description must be ${DESCRIPTION_LIMIT} characters or fewer.` };
  }
  if (!input.companyId) {
    return { ok: false, error: "A company is required for every task." };
  }
  if (!input.assignedTo) {
    return { ok: false, error: "An assignee is required." };
  }

  const supabase = createServiceClient();

  // Dedup for auto-generated tasks tied to a source record (currently:
  // the cash-escalation engine). Checked against the database directly
  // rather than an in-memory list passed in by the caller — more
  // reliable than the old client-side "does this task already exist in
  // what I happened to fetch" check.
  if (input.sourceType && input.sourceLabel) {
    const { data: existing } = await supabase
      .from("tasks")
      .select("id")
      .eq("source_type", input.sourceType)
      .eq("source_label", input.sourceLabel)
      .limit(1)
      .maybeSingle();
    if (existing) return { ok: true, taskId: null, skipped: true, reason: "duplicate" };
  }

  const assignedBy = input.actor.kind === "user" ? input.actor.name : input.actor.label;
  const assignedByEmail = input.actor.kind === "user" ? input.actor.email : "khuram1901@gmail.com";

  const { data: newTask, error } = await supabase
    .from("tasks")
    .insert({
      description,
      company_id: input.companyId,
      assigned_to: input.assignedTo,
      assigned_to_email: input.assignedToEmail,
      assigned_to_department: input.assignedToDepartment ?? null,
      assigned_to_business_unit: input.assignedToBusinessUnit ?? null,
      assigned_by: assignedBy,
      assigned_by_email: assignedByEmail,
      assigned_date: new Date().toISOString().slice(0, 10),
      due_date: input.dueDate ?? null,
      priority: input.priority ?? "Normal",
      status: input.status ?? "Not Started",
      project: input.project ?? null,
      stage: input.stage ?? null,
      notes: input.notes ?? null,
      task_type: input.taskType ?? "Task",
      reply_required: input.replyRequired ?? false,
      explanation_required: input.explanationRequired ?? false,
      exception_type: input.exceptionType ?? null,
      meeting_id: input.meetingId ?? null,
      source_type: input.sourceType ?? null,
      source_record_id: input.sourceRecordId ?? null,
      source_label: input.sourceLabel ?? null,
    })
    .select("id")
    .single();

  if (error || !newTask) return { ok: false, error: error?.message || "Failed to create task." };

  if (input.assignedToEmail && input.notificationStyle !== "none") {
    try {
      if (input.notificationStyle === "escalation") {
        await notifyEscalationTask(supabase, newTask.id, input.assignedToEmail);
      } else {
        await notifyTaskAssigned(supabase, newTask.id, input.assignedToEmail);
      }
    } catch (e) {
      // Task creation should never fail because the email happened to
      // fail — log it and move on. notification_log already has the
      // audit trail for send failures.
      console.error("Task created but notification failed", newTask.id, e);
    }
  }

  return { ok: true, taskId: newTask.id, skipped: false };
}
