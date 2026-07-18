import { NextRequest } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";
import { notifyTaskSubmittedToManager } from "../../../lib/task-notifications";

// Called immediately after a task is moved to "Submitted" status and
// routeSubmittedTask() has re-assigned it to the HOD. Sends the manager
// an email + WhatsApp alert so they know a task is waiting for sign-off
// without having to spot the bell badge themselves.
//
// Body: { taskId: string; managerEmail: string; submittedByName: string }
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { taskId, managerEmail, submittedByName } = await request.json();

    if (!taskId || !managerEmail || !submittedByName) {
      return Response.json({ error: "taskId, managerEmail and submittedByName are required" }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Verify the task exists and is actually Submitted before notifying —
    // guards against replayed or stale calls.
    const { data: task } = await supabase
      .from("tasks")
      .select("id, status, assigned_to_email")
      .eq("id", taskId)
      .maybeSingle();

    if (!task) return Response.json({ error: "Task not found" }, { status: 404 });
    if (task.status !== "Submitted") {
      return Response.json({ skipped: true, reason: "Task is not in Submitted status" });
    }

    await notifyTaskSubmittedToManager(supabase, taskId, managerEmail, submittedByName);
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
