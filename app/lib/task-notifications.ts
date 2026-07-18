import type { SupabaseClient } from "@supabase/supabase-js";
import { sendNotificationEmail } from "./send-email";
import { TRIGGER_TASK_ASSIGNED, TRIGGER_ESCALATION, TRIGGER_TASK_SUBMITTED } from "./notification-types";

// Extracted from /api/notifications/send so the exact same email logic can
// be called two ways: (1) that route, still used by paths not yet migrated
// onto /api/tasks/create, and (2) createTaskCore (task-creation.ts) directly
// when the task row is already in hand, with no self HTTP round-trip needed.
// Keeping this in one place means both callers send an identical email —
// see TASK_NOTIFICATION_AUDIT.md for why this consolidation matters.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://unze-cockpit.vercel.app";

export async function notifyTaskAssigned(
  supabase: SupabaseClient,
  taskId: string,
  recipientEmail: string
): Promise<{ skipped?: string } | void> {
  const { data: member } = await supabase
    .from("members")
    .select("first_name, last_name, name, notify_email, notify_whatsapp, phone_e164")
    .eq("email", recipientEmail)
    .maybeSingle();

  if (!member?.notify_email) return { skipped: "email notifications disabled" };

  const memberName = `${member.first_name || ""} ${member.last_name || ""}`.trim() || member.name || recipientEmail;

  const { data: task } = await supabase
    .from("tasks")
    .select("description, priority, due_date, assigned_by")
    .eq("id", taskId)
    .single();
  if (!task) return;

  await sendNotificationEmail({
    to: recipientEmail,
    subject: `[TASK] ${task.description?.slice(0, 60)}`,
    heading: "New Task Assigned to You",
    body: `
      <p><strong>${memberName}</strong>, you have a new task:</p>
      <p style="background:#f1f5f9;padding:12px;border-radius:6px;border-left:3px solid #2563eb">
        ${task.description}
      </p>
      <p><strong>Priority:</strong> ${task.priority || "Normal"}<br>
      <strong>Due:</strong> ${task.due_date ? task.due_date.split("-").reverse().join("/") : "No due date"}<br>
      <strong>Assigned by:</strong> ${task.assigned_by || "System"}</p>
    `,
    linkUrl: `${APP_URL}/tasks`,
    linkLabel: "View Tasks",
    triggerType: TRIGGER_TASK_ASSIGNED,
    triggerRecordId: taskId,
    recipientName: memberName,
    whatsAppPhone: member.notify_whatsapp ? member.phone_e164 : null,
    whatsAppMessage: `New task assigned: ${task.description?.slice(0, 100)}. Priority: ${task.priority}. Check the dashboard for details.`,
  });
}

// Sent to the HOD/manager the moment a task arrives in their queue as
// "Submitted" — gives them an immediate alert so nothing sits unseen.
// managerEmail is whoever routeSubmittedTask just assigned the task to.
// submittedByName is the original owner who clicked Submit.
export async function notifyTaskSubmittedToManager(
  supabase: SupabaseClient,
  taskId: string,
  managerEmail: string,
  submittedByName: string
): Promise<{ skipped?: string } | void> {
  const { data: manager } = await supabase
    .from("members")
    .select("first_name, last_name, name, notify_email, notify_whatsapp, phone_e164")
    .eq("email", managerEmail)
    .maybeSingle();

  if (!manager?.notify_email) return { skipped: "email notifications disabled" };

  const managerName = `${manager.first_name || ""} ${manager.last_name || ""}`.trim() || manager.name || managerEmail;

  const { data: task } = await supabase
    .from("tasks")
    .select("description, priority, due_date")
    .eq("id", taskId)
    .single();
  if (!task) return;

  await sendNotificationEmail({
    to: managerEmail,
    subject: `[Sign-off Required] ${task.description?.slice(0, 55)}`,
    heading: "Task Submitted — Your Sign-off Required",
    body: `
      <p><strong>${managerName}</strong>, a task has been submitted for your approval:</p>
      <p style="background:#fffbeb;padding:12px;border-radius:6px;border-left:3px solid #b4791f">
        ${task.description}
      </p>
      <p><strong>Submitted by:</strong> ${submittedByName}<br>
      <strong>Priority:</strong> ${task.priority || "Normal"}<br>
      <strong>Due:</strong> ${task.due_date ? task.due_date.split("-").reverse().join("/") : "No due date"}</p>
      <p>Please review and mark it as Completed (or return it) from your Tasks page.</p>
    `,
    linkUrl: `${APP_URL}/tasks?filter=submitted&scope=mine`,
    linkLabel: "Review Submitted Tasks",
    triggerType: TRIGGER_TASK_SUBMITTED,
    triggerRecordId: taskId,
    recipientName: managerName,
    whatsAppPhone: manager.notify_whatsapp ? manager.phone_e164 : null,
    whatsAppMessage: `Sign-off required: "${task.description?.slice(0, 80)}" submitted by ${submittedByName}. Open the dashboard to review.`,
  });
}

export async function notifyEscalationTask(
  supabase: SupabaseClient,
  taskId: string,
  recipientEmail: string
): Promise<{ skipped?: string } | void> {
  const { data: member } = await supabase
    .from("members")
    .select("first_name, last_name, name, notify_email, notify_whatsapp, phone_e164")
    .eq("email", recipientEmail)
    .maybeSingle();

  if (!member?.notify_email) return { skipped: "email notifications disabled" };

  const memberName = `${member.first_name || ""} ${member.last_name || ""}`.trim() || member.name || recipientEmail;

  const { data: task } = await supabase
    .from("tasks")
    .select("description, exception_type, source_type")
    .eq("id", taskId)
    .single();
  if (!task) return;

  await sendNotificationEmail({
    to: recipientEmail,
    subject: `[!] Escalation: ${task.exception_type || "KPI Alert"}`,
    heading: "Escalation Raised — Action Required",
    body: `
      <p><strong>${memberName}</strong>, an escalation has been raised:</p>
      <p style="background:#fef2f2;padding:12px;border-radius:6px;border-left:3px solid #dc2626">
        ${task.description}
      </p>
      <p>Please review and respond with an explanation within the due date.</p>
    `,
    linkUrl: `${APP_URL}/tasks`,
    linkLabel: "View & Respond",
    triggerType: TRIGGER_ESCALATION,
    triggerRecordId: taskId,
    recipientName: memberName,
    whatsAppPhone: member.notify_whatsapp ? member.phone_e164 : null,
    whatsAppMessage: `Escalation: ${task.description?.slice(0, 100)}. Please check the dashboard and respond.`,
  });
}
