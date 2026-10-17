import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { sendNotificationEmail } from "../../../lib/send-email";
import { formatDateUK } from "../../../lib/dateUtils";
import { TRIGGER_TASK_OVERDUE } from "../../../lib/notification-types";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://pulse.unze.co.uk";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const today = new Date().toISOString().slice(0, 10);

    // Fetch all open overdue tasks that have an assignee email
    const { data: overdueTasks, error } = await supabase
      .from("tasks")
      .select("id, description, due_date, assigned_to, assigned_to_email, priority, project")
      .not("status", "in", '("Completed","Cancelled")')
      .lt("due_date", today)
      .not("assigned_to_email", "is", null);

    if (error) throw error;
    if (!overdueTasks || overdueTasks.length === 0) {
      return Response.json({ ok: true, message: "No overdue tasks", sent: 0 });
    }

    // Group tasks by assignee email
    const byAssignee = new Map<string, typeof overdueTasks>();
    for (const task of overdueTasks) {
      if (!task.assigned_to_email) continue;
      const email = task.assigned_to_email.toLowerCase();
      const list = byAssignee.get(email) ?? [];
      list.push(task);
      byAssignee.set(email, list);
    }

    let sent = 0;
    let skipped = 0;

    for (const [email, tasks] of byAssignee.entries()) {
      // Check member notification preferences
      const { data: member } = await supabase
        .from("members")
        .select("first_name, last_name, name, notify_email, notif_task_overdue, is_active")
        .eq("email", email)
        .maybeSingle();

      if (!member?.is_active) { skipped++; continue; }
      if (!member?.notify_email) { skipped++; continue; }
      // notif_task_overdue defaults to true (null = opted in); only skip if explicitly false
      if (member?.notif_task_overdue === false) { skipped++; continue; }

      // Dedup: skip if we already sent this trigger to this member today
      const { data: existing } = await supabase
        .from("notification_log")
        .select("id")
        .eq("trigger_type", TRIGGER_TASK_OVERDUE)
        .eq("recipient_email", email)
        .gte("sent_at", `${today}T00:00:00Z`)
        .maybeSingle();

      if (existing) { skipped++; continue; }

      const memberName =
        `${member.first_name || ""} ${member.last_name || ""}`.trim() ||
        member.name ||
        email;
      const count = tasks.length;

      // Sort by most overdue first
      const sorted = [...tasks].sort((a, b) =>
        (a.due_date ?? "").localeCompare(b.due_date ?? "")
      );

      const taskRows = sorted
        .map((t) => {
          const daysOverdue = Math.floor(
            (new Date(today).getTime() - new Date(t.due_date!).getTime()) / 86400000
          );
          return `<tr>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;max-width:340px;word-break:break-word">${(t.description ?? "Untitled").slice(0, 100)}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;white-space:nowrap;color:#dc2626;font-weight:600">${formatDateUK(t.due_date)}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;white-space:nowrap;color:#dc2626">${daysOverdue}d overdue</td>
          </tr>`;
        })
        .join("");

      const body = `
        <p><strong>${memberName}</strong>, you have <strong style="color:#dc2626">${count} overdue task${count > 1 ? "s" : ""}</strong> that need${count === 1 ? "s" : ""} your attention:</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
          <thead>
            <tr style="background:#f8fafc">
              <th style="padding:8px 12px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#64748b">Task</th>
              <th style="padding:8px 12px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#64748b">Due Date</th>
              <th style="padding:8px 12px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#64748b">Overdue By</th>
            </tr>
          </thead>
          <tbody>${taskRows}</tbody>
        </table>
        <p style="color:#64748b;font-size:13px">Please update the status of each task or request an extension from your manager.</p>
      `;

      await sendNotificationEmail({
        to: email,
        subject: `⚠️ ${count} Overdue Task${count > 1 ? "s" : ""} — Action Required`,
        heading: "You Have Overdue Tasks",
        body,
        linkUrl: `${APP_URL}/tasks`,
        linkLabel: "View My Tasks",
        triggerType: TRIGGER_TASK_OVERDUE,
        triggerRecordId: tasks[0].id,
        recipientName: memberName,
      });

      sent++;
    }

    return Response.json({
      ok: true,
      sent,
      skipped,
      total_overdue_tasks: overdueTasks.length,
    });
  } catch (err) {
    console.error("[task-overdue cron]", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
