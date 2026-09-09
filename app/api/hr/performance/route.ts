import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth, getMemberAccess } from "../../../lib/api-auth";

// GET /api/hr/performance?days=90
// Returns performance summary from get_performance_summary RPC.
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  // Role gate (09/09/2026 access audit): performance data is for
  // management roles + HR department, not every authenticated user.
  const access = await getMemberAccess(auth.email);
  if (!access.hrDirectory) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const days = Math.min(365, Math.max(7, parseInt(searchParams.get("days") ?? "90", 10)));

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("get_performance_summary", {
    p_days:        days,
    p_company_ids: null,   // all companies
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
