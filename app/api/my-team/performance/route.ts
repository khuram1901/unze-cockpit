import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// GET /api/my-team/performance?days=90
// Gate: can_view_team_performance permission (set on all HODs)
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const db = createServiceClient();

  // Check permission — Admins and CEOs bypass; everyone else needs explicit can_view_team_performance
  const { data: member } = await db
    .from("members")
    .select("id, role")
    .eq("email", auth.email)
    .maybeSingle();

  const isAdminOrCeo = member?.role === "Admin" || member?.role === "CEO";

  if (!isAdminOrCeo) {
    const { data: mp } = await db
      .from("member_permissions")
      .select("can_view_team_performance")
      .eq("member_id", member?.id ?? "")
      .maybeSingle();

    if (!mp?.can_view_team_performance) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
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
