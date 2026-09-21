import { NextRequest } from "next/server";
import { createServiceClient } from "../../../../lib/supabase-server";
import { createTaskCore } from "../../../../lib/task-creation";

// POST /api/tasks/recurring/fire-now
// Spawns the first task instance immediately when a recurring template is created.
// Accepts an explicit firstDueDate (YYYY-MM-DD) chosen by the creator in the form.
// Called client-side right after inserting into recurring_tasks so the assignee
// sees a task straight away, rather than waiting for the next cron cycle.
export async function POST(request: NextRequest) {
  try {
    const { templateId, firstDueDate } = await request.json();
    if (!templateId) return Response.json({ error: "templateId required" }, { status: 400 });
    if (!firstDueDate) return Response.json({ error: "firstDueDate required" }, { status: 400 });

    const supabase = createServiceClient();

    const { data: tmpl, error: fetchErr } = await supabase
      .from("recurring_tasks")
      .select("id, description, frequency, due_days_after, company_id, assigned_to, assigned_to_email, assigned_to_department, priority, project, assigned_by, created_by_email")
      .eq("id", templateId)
      .single();

    if (fetchErr || !tmpl) return Response.json({ error: "Template not found" }, { status: 404 });
    if (!tmpl.company_id) return Response.json({ error: "No company set on template" }, { status: 400 });
    if (!tmpl.assigned_to) return Response.json({ error: "No assignee set on template" }, { status: 400 });

    // Use the explicitly chosen first due date — do not derive from frequency
    // so the creator's intent is preserved and we don't assume the cycle day
    const dueDateStr: string = firstDueDate;

    const requiresManagerSignoff = !tmpl.created_by_email
      || tmpl.created_by_email.trim().toLowerCase() !== (tmpl.assigned_to_email || "").trim().toLowerCase();

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
      requiresManagerSignoff,
    });

    if (!result.ok) return Response.json({ error: result.error }, { status: 500 });

    // Stamp last_created_at so the cron doesn't double-fire on the same day
    await supabase
      .from("recurring_tasks")
      .update({ last_created_at: new Date().toISOString() })
      .eq("id", templateId);

    return Response.json({ ok: true, taskId: result.taskId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
