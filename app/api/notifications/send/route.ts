import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { sendNotificationEmail } from "../../../lib/send-email";
import { rateLimitByIP, rateLimitResponse } from "../../../lib/rate-limit";
import { requireAuth } from "../../../lib/api-auth";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://unze-cockpit.vercel.app";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const rl = rateLimitByIP(request, 20, 60000);
  if (!rl.allowed) return rateLimitResponse();
  try {
    const { type, taskId, recipientEmail } = await request.json();

    if (!type || !recipientEmail) {
      return Response.json({ error: "type and recipientEmail required" }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: member } = await supabase
      .from("members")
      .select("first_name, last_name, name, notify_email, notify_whatsapp, phone_e164")
      .eq("email", recipientEmail)
      .maybeSingle();

    if (!member?.notify_email) {
      return Response.json({ skipped: true, reason: "email notifications disabled" });
    }

    const memberName = `${member.first_name || ""} ${member.last_name || ""}`.trim() || member.name || recipientEmail;

    if (type === "task_assigned" && taskId) {
      const { data: task } = await supabase
        .from("tasks")
        .select("description, priority, due_date, assigned_by")
        .eq("id", taskId)
        .single();

      if (!task) return Response.json({ error: "Task not found" }, { status: 404 });

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
          <strong>Due:</strong> ${task.due_date || "No due date"}<br>
          <strong>Assigned by:</strong> ${task.assigned_by || "System"}</p>
        `,
        linkUrl: `${APP_URL}/tasks`,
        linkLabel: "View Tasks",
        triggerType: "task_assigned",
        triggerRecordId: taskId,
        recipientName: memberName,
        whatsAppPhone: member.notify_whatsapp ? member.phone_e164 : null,
        whatsAppMessage: `New task assigned: ${task.description?.slice(0, 100)}. Priority: ${task.priority}. Check the dashboard for details.`,
      });

      return Response.json({ success: true });
    }

    if (type === "escalation" && taskId) {
      const { data: task } = await supabase
        .from("tasks")
        .select("description, exception_type, source_type")
        .eq("id", taskId)
        .single();

      if (!task) return Response.json({ error: "Task not found" }, { status: 404 });

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
        triggerType: "escalation",
        triggerRecordId: taskId,
        recipientName: memberName,
        whatsAppPhone: member.notify_whatsapp ? member.phone_e164 : null,
        whatsAppMessage: `Escalation: ${task.description?.slice(0, 100)}. Please check the dashboard and respond.`,
      });

      return Response.json({ success: true });
    }

    return Response.json({ error: "Unknown notification type" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
