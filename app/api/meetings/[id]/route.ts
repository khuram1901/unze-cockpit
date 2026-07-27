import { NextRequest } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";

// PATCH — update meeting fields
// DELETE — remove meeting, meeting_tasks, meeting_attendees
// Admin/CEO only (meetings_admin capability is already enforced on the page).
// We re-check role here server-side so API calls can't bypass it.

const ALLOWED_ROLES = ["Admin", "CEO"];

async function checkAdmin(auth: { email: string }) {
  const supabase = createServiceClient();
  const { data: member } = await supabase
    .from("members")
    .select("role")
    .eq("email", auth.email)
    .maybeSingle();
  return ALLOWED_ROLES.includes(member?.role ?? "");
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  if (!(await checkAdmin(auth))) {
    return Response.json({ error: "Only Admin/CEO can edit meetings" }, { status: 403 });
  }

  const { id } = params;
  if (!id) return Response.json({ error: "Meeting id required" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Whitelist the fields callers are allowed to update
  const allowed = [
    "title", "meeting_date", "executive_summary",
    "decisions", "risks", "opportunities", "attendees",
    "department", "company",
  ] as const;

  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("meetings")
    .update(updates)
    .eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  if (!(await checkAdmin(auth))) {
    return Response.json({ error: "Only Admin/CEO can delete meetings" }, { status: 403 });
  }

  const { id } = params;
  if (!id) return Response.json({ error: "Meeting id required" }, { status: 400 });

  const supabase = createServiceClient();

  // Remove junction records first to avoid FK conflicts
  await supabase.from("meeting_tasks").delete().eq("meeting_id", id);
  await supabase.from("meeting_attendees").delete().eq("meeting_id", id);

  const { error } = await supabase.from("meetings").delete().eq("id", id);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
