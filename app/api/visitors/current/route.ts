import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { isAdmin } from "../../../lib/admin-config";

/** Resolve whether the caller can use the visitor-entry page at all.
 *  Same logic as canAccessVisitorEntry() in permissions.ts —
 *  admin tier OR has the admin_ops.visitor_entry widget enabled. */
async function canAccess(
  auth: { email: string },
  supabase: ReturnType<typeof createServiceClient>,
): Promise<boolean> {
  if (isAdmin(auth.email.toLowerCase())) return true;
  const { data: member } = await supabase
    .from("members")
    .select("id, role")
    .eq("email", auth.email)
    .single();
  if (!member) return false;
  if (["admin", "ceo"].includes(member.role.toLowerCase())) return true;
  const { data: ov } = await supabase
    .from("member_widget_overrides")
    .select("visible")
    .eq("member_id", member.id)
    .eq("widget_key", "admin_ops.visitor_entry")
    .eq("visible", true)
    .maybeSingle();
  return ov?.visible === true;
}

/** GET /api/visitors/current
 *  Returns all visitors currently inside (time_out IS NULL) for today.
 *  Requires: authenticated + admin tier OR admin_ops.visitor_entry widget.
 *  Returns minimal fields — only what the check-out panel needs. */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  if (!(await canAccess(auth, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  // Pass p_caller_email so Postgres picks the migration-278 overload (8 params),
  // not the older 7-param version. Without this the two overloads are ambiguous
  // and Postgres throws "function is not unique", which silently empties the list.
  // No date filter — show ALL inside visitors (anyone not yet checked out).
  const { data, error } = await supabase.rpc("visitor_list_paged", {
    p_date_from:    null,
    p_date_to:      null,
    p_department:   null,
    p_search:       null,
    p_status:       "inside",
    p_limit:        200,
    p_offset:       0,
    p_caller_email: auth.email,  // migration 278 — also selects correct overload
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows = ((data as { rows?: unknown[] })?.rows ?? []) as Array<{
    id: string;
    visitor_name: string;
    host_name: string;
    time_in: string;
    department_name: string;
    purpose: string;
  }>;

  return Response.json({ visitors: rows });
}
