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

export type AdditionalAssignee = {
  memberId?: string | null;
  name: string;
  email: string | null;
};

export type CreateTaskInput = {
  description: string;
  companyId: string;
  assignedTo: string;
  assignedToEmail: string | null;
  assignedToMemberId?: string | null;
  // Genuine co-owners (Khuram: "same task assigned to multiple members") —
  // each shows up in their own My Tasks, not just a heads-up. assignedTo/
  // assignedToEmail above stay the "primary" owner for every existing
  // report/filter/notification that only knows about one; this list is
  // additive, stored in task_assignees alongside the primary.
  additionalAssignees?: AdditionalAssignee[];
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
  // Khuram (17/07/2026): "this only applies if the tasks was created by
  // their HOD/manager, via minutes of meeting or via Personal assistant.
  // otherwise all tasks created by themselves they can complete." When
  // left unset, defaults to true unless the assignee and the creator are
  // the same person (a genuine self-created task) -- see the fallback
  // below. Callers that know better set this explicitly: the PA quick-add
  // form always passes true (a task "via Personal Assistant" needs sign-
  // off even if the PA assigned it to themselves), and meeting-minutes
  // tasks are already covered by meetingId being set.
  requiresManagerSignoff?: boolean;
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
  // Khuram (24/07/2026): "we need to ensure every task has the correct
  // company, department, owner, tasks due date before its allowed to be
  // added." Company and owner are checked above; due date now hard-
  // required here too so no path (form, quick-add, minutes, import) can
  // create an undated task. Department derives from the owner's member
  // record at every call site.
  if (!input.dueDate) {
    return { ok: false, error: "A due date is required for every task." };
  }
  // CEO assignment lock (Khuram, 24/07/2026): "no one is assigning task
  // to me or Kamran as we are the ceo, they can ask us questions
  // comments" — questions go via Waiting Reply. Only the CEOs' own
  // accounts and the PA (who manages the CEO's list) may assign a task
  // to a CEO account. System actors (cash escalation, recurring cron)
  // are trusted server-side callers and stay allowed.
  const CEO_LOCKED = ["khuram1901@gmail.com", "k.saleem@unzegroup.com", "kamran@unze.co.uk"];
  const ALLOWED_TO_ASSIGN_CEO = [...CEO_LOCKED, "pa.ceo@unze.co.uk"];
  if (input.actor.kind === "user" && !ALLOWED_TO_ASSIGN_CEO.includes(input.actor.email.toLowerCase())) {
    const targets = [
      input.assignedToEmail,
      ...(input.additionalAssignees || []).map((a) => a.email),
    ].filter((e): e is string => !!e).map((e) => e.toLowerCase());
    if (targets.some((e) => CEO_LOCKED.includes(e))) {
      return { ok: false, error: "Tasks can't be assigned to the CEO. If you need their input, set your task to Waiting Reply and tag them instead." };
    }
  }
  // A task can only reach Completed by going through Submitted -> HOD
  // "Mark Complete" (see supabase/114/115/117). That gate only runs on
  // UPDATE, so without this check anyone creating a task could just hand
  // themselves a pre-closed one at INSERT time and skip HOD review
  // entirely — found during the 15 Jul 2026 full-app audit.
  if (input.status === "Completed") {
    return { ok: false, error: "A task can't be created already Completed — it must go through Submitted and HOD sign-off first." };
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

  // See requiresManagerSignoff's doc comment above. Default rule when a
  // caller doesn't specify: a meeting-linked task, or one where the
  // creator and the assignee are different people, needs sign-off; a
  // task someone created and assigned to themselves doesn't.
  const requiresManagerSignoff = input.requiresManagerSignoff !== undefined
    ? input.requiresManagerSignoff
    : !!input.meetingId || (input.assignedToEmail || "").trim().toLowerCase() !== assignedByEmail.trim().toLowerCase();

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
      requires_manager_signoff: requiresManagerSignoff,
    })
    .select("id")
    .single();

  if (error || !newTask) return { ok: false, error: error?.message || "Failed to create task." };

  // Full owner list, primary included — task_assignees is the source of
  // truth for "who owns this" going forward (RLS on tasks itself checks
  // this table too, see migration 112), while assigned_to/assigned_to_email
  // above stay populated exactly as before for every existing consumer
  // that only knows about one owner.
  const rawAssignees = [
    { memberId: input.assignedToMemberId ?? null, name: input.assignedTo, email: input.assignedToEmail },
    ...(input.additionalAssignees ?? []),
  ];
  const seenKeys = new Set<string>();
  const assigneeRows = rawAssignees.filter((a) => {
    const key = (a.email || a.name).trim().toLowerCase();
    if (!key || seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });
  if (assigneeRows.length > 0) {
    const { error: assigneeError } = await supabase.from("task_assignees").insert(
      assigneeRows.map((a) => ({ task_id: newTask.id, member_id: a.memberId ?? null, member_name: a.name, member_email: a.email }))
    );
    if (assigneeError) console.error("Task created but task_assignees insert failed", newTask.id, assigneeError);
  }

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

  // Co-owners get the same "you've been assigned" notification the
  // primary owner does — real shared ownership means everyone added
  // actually finds out, not just the first person picked.
  if (input.notificationStyle !== "none") {
    for (const a of input.additionalAssignees ?? []) {
      if (!a.email) continue;
      try {
        if (input.notificationStyle === "escalation") {
          await notifyEscalationTask(supabase, newTask.id, a.email);
        } else {
          await notifyTaskAssigned(supabase, newTask.id, a.email);
        }
      } catch (e) {
        console.error("Task created but co-assignee notification failed", newTask.id, a.email, e);
      }
    }
  }

  return { ok: true, taskId: newTask.id, skipped: false };
}
