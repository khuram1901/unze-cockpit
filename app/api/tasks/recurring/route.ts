import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { createTaskCore } from "../../../lib/task-creation";

// Migrated onto the shared createTaskCore gate (see task-creation.ts) —
// this cron previously inserted into `tasks` directly, one of the 7
// original call sites documented in TASK_NOTIFICATION_AUDIT.md. Runs
// server-side on its own service client with no logged-in user, so it
// calls createTaskCore in-process rather than round-tripping through
// /api/tasks/create (that route requires a user auth token this cron
// doesn't have).
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
    const skipped: { id: string; description: string; reason: string }[] = [];

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

      // createTaskCore hard-requires both a company and an assignee on
      // every task — a template missing either (surfaced as the amber
      // "No company set" badge on the Recurring Tasks tab) is skipped and
      // reported back rather than silently failing or crashing the run.
      if (!tmpl.company_id) {
        skipped.push({ id: tmpl.id, description: tmpl.description, reason: "no company set on template" });
        continue;
      }
      if (!tmpl.assigned_to) {
        skipped.push({ id: tmpl.id, description: tmpl.description, reason: "no assignee set on template" });
        continue;
      }

      const dueDate = new Date(now);
      dueDate.setDate(dueDate.getDate() + (tmpl.due_days_after || 3));
      const dueDateStr = dueDate.toISOString().slice(0, 10);

      const result = await createTaskCore({
        description: tmpl.description,
        companyId: tmpl.company_id,
        assignedTo: tmpl.assigned_to,
        assignedToEmail: tmpl.assigned_to_email,
        assignedToDepartment: tmpl.assigned_to_department,
        dueDate: dueDateStr,
        priority: tmpl.priority || "Normal",
        project: tmpl.project,
        status: "Not Started",
        taskType: "Recurring",
        actor: { kind: "system", label: tmpl.assigned_by || "Recurring Task" },
      });

      if (!result.ok) {
        skipped.push({ id: tmpl.id, description: tmpl.description, reason: result.error });
        continue;
      }

      await supabase.from("recurring_tasks").update({ last_created_at: now.toISOString() }).eq("id", tmpl.id);
      created++;
    }

    return Response.json({ ok: true, created, skipped, date: today });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
