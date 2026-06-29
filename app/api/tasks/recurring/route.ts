import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...
    const dayOfMonth = now.getDate();

    const { data: templates } = await supabase
      .from("recurring_tasks")
      .select("*")
      .eq("active", true);

    if (!templates || templates.length === 0) {
      return Response.json({ ok: true, created: 0, message: "No active recurring tasks" });
    }

    let created = 0;

    for (const tmpl of templates) {
      let shouldCreate = false;

      if (tmpl.frequency === "daily") {
        shouldCreate = true;
      } else if (tmpl.frequency === "weekly" && tmpl.day_of_week === dayOfWeek) {
        shouldCreate = true;
      } else if (tmpl.frequency === "monthly" && tmpl.day_of_month === dayOfMonth) {
        shouldCreate = true;
      }

      // Don't create if already created today
      if (shouldCreate && tmpl.last_created_at) {
        const lastDate = tmpl.last_created_at.slice(0, 10);
        if (lastDate === today) shouldCreate = false;
      }

      if (!shouldCreate) continue;

      const dueDate = new Date(now);
      dueDate.setDate(dueDate.getDate() + (tmpl.due_days_after || 3));
      const dueDateStr = dueDate.toISOString().slice(0, 10);

      await supabase.from("tasks").insert({
        description: tmpl.description,
        assigned_to: tmpl.assigned_to,
        assigned_to_email: tmpl.assigned_to_email,
        assigned_to_department: tmpl.assigned_to_department,
        assigned_by: tmpl.assigned_by || "Recurring Task",
        assigned_date: today,
        due_date: dueDateStr,
        priority: tmpl.priority || "Normal",
        project: tmpl.project,
        status: "Not Started",
        task_type: "Recurring",
      });

      await supabase.from("recurring_tasks").update({ last_created_at: now.toISOString() }).eq("id", tmpl.id);

      // Notify assignee
      if (tmpl.assigned_to_email) {
        try {
          await fetch(`${process.env.NEXT_PUBLIC_APP_URL || "https://unze-cockpit.vercel.app"}/api/notifications/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "task_assigned", recipientEmail: tmpl.assigned_to_email }),
          });
        } catch (e) { console.error("Failed to notify", tmpl.assigned_to_email, e); }
      }

      created++;
    }

    return Response.json({ ok: true, created, date: today });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
