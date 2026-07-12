import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { sendNotificationEmail } from "../../../lib/send-email";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://unze-cockpit.vercel.app";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const today = new Date().toISOString().slice(0, 10);

    // Get all open tasks
    const { data: tasks } = await supabase
      .from("tasks")
      .select("*")
      .not("status", "in", '("Completed","Cancelled")')
      .order("due_date");

    const allTasks = tasks || [];
    const overdue = allTasks.filter((t) => t.due_date && t.due_date < today);
    const waitingReply = allTasks.filter((t) => t.status === "Waiting Reply");
    const dueToday = allTasks.filter((t) => t.due_date === today);

    // Get escalations
    const escalations = allTasks.filter(
      (t) => t.source_type === "kpi_escalation" || t.source_type === "receivable_escalation"
    );

    // Get Admin and Executive members who have email notifications on.
    // The CEO's two addresses are excluded here — he now gets a single
    // consolidated digest instead (app/api/notifications/ceo-digest/route.ts).
    const { data: admins } = await supabase
      .from("members")
      .select("email, first_name, last_name, name, role, notify_email, phone_e164, notify_whatsapp")
      .in("role", ["Admin", "Executive"])
      .eq("notify_email", true)
      .not("email", "in", '("khuram1901@gmail.com","k.saleem@unzegroup.com")');

    if (!admins || admins.length === 0) {
      return Response.json({ ok: true, message: "No admin/executive with notifications enabled", sent: 0 });
    }

    let sent = 0;

    for (const admin of admins) {
      const adminName = `${admin.first_name || ""} ${admin.last_name || ""}`.trim() || admin.name || admin.email;
      const isAdmin = admin.role === "Admin";

      const items: string[] = [];
      if (overdue.length > 0) items.push(`<li style="color:#dc2626"><strong>${overdue.length} overdue task${overdue.length > 1 ? "s" : ""}</strong></li>`);
      if (waitingReply.length > 0) items.push(`<li style="color:#dc2626"><strong>${waitingReply.length} waiting reply</strong></li>`);
      if (escalations.length > 0) items.push(`<li style="color:#d97706"><strong>${escalations.length} active escalation${escalations.length > 1 ? "s" : ""}</strong></li>`);
      if (dueToday.length > 0) items.push(`<li><strong>${dueToday.length} due today</strong></li>`);
      items.push(`<li>${allTasks.length} total open tasks</li>`);

      const subject = overdue.length > 0 || escalations.length > 0
        ? `[!] Daily Digest -${overdue.length} overdue, ${escalations.length} escalations`
        : `Daily Digest -${allTasks.length} open tasks`;

      await sendNotificationEmail({
        to: admin.email!,
        subject,
        heading: `Good Morning ${adminName}`,
        body: `
          <p>Here is your daily summary:</p>
          <ul style="padding-left:20px;line-height:2">${items.join("")}</ul>
          ${overdue.length > 0 ? `
          <p style="margin-top:12px"><strong>Top overdue:</strong></p>
          <ul style="padding-left:20px;font-size:13px">
            ${overdue.slice(0, 5).map((t) => `<li>${t.description?.slice(0, 80)} -${t.assigned_to || "Unassigned"} (due ${t.due_date})</li>`).join("")}
          </ul>` : ""}
        `,
        linkUrl: isAdmin ? `${APP_URL}/home` : `${APP_URL}/pa`,
        linkLabel: isAdmin ? "Open Executive Dashboard" : "Open PA Dashboard",
        triggerType: "daily_digest",
        recipientName: adminName,
        whatsAppPhone: admin.notify_whatsapp ? admin.phone_e164 : null,
        whatsAppMessage: `Daily Summary: ${overdue.length} overdue, ${waitingReply.length} waiting reply, ${escalations.length} escalations. Check the dashboard for details.`,
      });

      sent++;
    }

    return Response.json({ ok: true, sent, overdue: overdue.length, escalations: escalations.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Daily digest error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
