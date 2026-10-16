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
  if (["admin", "ceo"].includes(member.role)) return true;
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

  // Today in PKT (UTC+5)
  const nowUtc = new Date();
  const pktOffset = 5 * 60 * 60 * 1000;
  const pktNow   = new Date(nowUtc.getTime() + pktOffset);
  const today    = pktNow.toISOString().slice(0, 10); // YYYY-MM-DD

  const { data, error } = await supabase.rpc("visitor_list_paged", {
    p_date_from:  today,
    p_date_to:    today,
    p_department: null,
    p_search:     null,
    p_status:     "inside",
    p_limit:      100,
    p_offset:     0,
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
