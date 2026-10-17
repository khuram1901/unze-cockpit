import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { isAdmin } from "../../../lib/admin-config";

async function canView(auth: { email: string }, supabase: ReturnType<typeof createServiceClient>) {
  if (isAdmin(auth.email.toLowerCase())) return true;
  const { data: member } = await supabase.from("members").select("id, role").eq("email", auth.email).single();
  if (!member) return false;
  if (["admin", "ceo"].includes(member.role.toLowerCase())) return true;
  const { data: ov } = await supabase
    .from("member_widget_overrides")
    .select("is_enabled")
    .eq("member_id", member.id)
    .eq("widget_key", "admin_ops.visitors")
    .eq("is_enabled", true)
    .maybeSingle();
  return ov?.is_enabled === true;
}

/** GET /api/visitors/list
 * Query params: date_from, date_to, department, search, status, limit, offset
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  if (!(await canView(auth, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const { data, error } = await supabase.rpc("visitor_list_paged", {
    p_date_from:  sp.get("date_from")  || null,
    p_date_to:    sp.get("date_to")    || null,
    p_department: sp.get("department") || null,
    p_search:     sp.get("search")     || null,
    p_status:     sp.get("status")     || null,
    p_limit:      parseInt(sp.get("limit")  || "50",  10),
    p_offset:     parseInt(sp.get("offset") || "0",   10),
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

/** PATCH /api/visitors/list
 * Edits a visitor_log record (with audit trail).
 * Body: { id, ...fields }
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  if (!(await canView(auth, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const { data: member } = await supabase.from("members").select("id").eq("email", auth.email).single();
  if (!member) return Response.json({ error: "Member not found" }, { status: 403 });

  const body = await request.json();
  const { id, ...fields } = body;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  // Get old values for audit
  const { data: old } = await supabase.from("visitor_log").select("*").eq("id", id).single();
  if (!old) return Response.json({ error: "Not found" }, { status: 404 });

  // Allowed editable fields
  const allowed = [
    "visitor_name","mobile","cnic","department_name","host_member_id","host_name",
    "purpose","purpose_other","comments","time_in","time_out","visit_date",
  ] as const;
  const updatePayload: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in fields) updatePayload[key] = fields[key] ?? null;
  }

  if (Object.keys(updatePayload).length === 0) {
    return Response.json({ error: "No editable fields provided" }, { status: 400 });
  }

  const { error: updateErr } = await supabase
    .from("visitor_log")
    .update(updatePayload)
    .eq("id", id)
    .eq("is_deleted", false);

  if (updateErr) return Response.json({ error: updateErr.message }, { status: 500 });

  // Audit trail
  try {
    await supabase.from("visitor_audit_log").insert({
      visitor_id:  id,
      changed_by:  member.id,
      change_type: "update",
      old_values:  old,
      new_values:  updatePayload,
    }).throwOnError();
  } catch { /* best-effort */ }

  return Response.json({ ok: true });
}

/** DELETE /api/visitors/list
 * Soft-deletes a visitor_log record.
 * Body: { id }
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  if (!(await canView(auth, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const { data: member } = await supabase.from("members").select("id").eq("email", auth.email).single();
  if (!member) return Response.json({ error: "Member not found" }, { status: 403 });

  const body = await request.json();
  const { id, delete_reason } = body;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  if (!delete_reason?.trim()) return Response.json({ error: "delete_reason required" }, { status: 400 });

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("visitor_log")
    .update({ is_deleted: true, deleted_at: now, deleted_by: member.id, delete_reason: delete_reason.trim() })
    .eq("id", id)
    .eq("is_deleted", false);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  try {
    await supabase.from("visitor_audit_log").insert({
      visitor_id:  id,
      changed_by:  member.id,
      change_type: "delete",
      new_values:  { deleted_at: now, delete_reason: delete_reason.trim() },
    }).throwOnError();
  } catch { /* best-effort */ }

  return Response.json({ ok: true });
}
