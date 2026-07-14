import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { rateLimitByIP, rateLimitResponse } from "../../../lib/rate-limit";
import { requireAuth } from "../../../lib/api-auth";
import { notifyTaskAssigned, notifyEscalationTask } from "../../../lib/task-notifications";
import { TRIGGER_TASK_ASSIGNED, TRIGGER_ESCALATION } from "../../../lib/notification-types";

// Thin wrapper — the actual email-building logic now lives in
// task-notifications.ts, shared with createTaskCore (task-creation.ts) so
// both send an identical email. This route stays in place for call sites
// not yet migrated onto /api/tasks/create; same request/response shape as
// before, zero behaviour change.
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
    if (!taskId) {
      return Response.json({ error: "taskId required" }, { status: 400 });
    }

    const supabase = createServiceClient();

    if (type === TRIGGER_TASK_ASSIGNED) {
      const result = await notifyTaskAssigned(supabase, taskId, recipientEmail);
      if (result?.skipped) return Response.json({ skipped: true, reason: result.skipped });
      return Response.json({ success: true });
    }

    if (type === TRIGGER_ESCALATION) {
      const result = await notifyEscalationTask(supabase, taskId, recipientEmail);
      if (result?.skipped) return Response.json({ skipped: true, reason: result.skipped });
      return Response.json({ success: true });
    }

    return Response.json({ error: "Unknown notification type" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
