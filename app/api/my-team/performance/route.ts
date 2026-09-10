import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// GET /api/my-team/performance?days=90
// Gate: can_view_team_performance permission (set on all HODs)
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const db = createServiceClient();

  // Check permission
  const { data: member } = await db
    .from("members")
    .select("id, member_permissions(can_view_team_performance)")
    .eq("email", auth.email)
    .maybeSingle();

  const perms = Array.isArray(member?.member_permissions)
    ? member?.member_permissions[0]
    : member?.member_permissions;

  if (!perms?.can_view_team_performance) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const days = Math.min(365, Math.max(7, parseInt(searchParams.get("days") ?? "90", 10)));

  const { data, error } = await db.rpc("get_hod_team_performance", {
    p_hod_email: auth.email,
    p_days: days,
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
