import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth, getMemberAccess } from "../../../lib/api-auth";

// GET /api/hr/employee-performance?email=...&days=90
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  // Role gate (09/09/2026 access audit): performance data is for
  // management roles + HR department, not every authenticated user.
  const access = await getMemberAccess(auth.email);
  if (!access.hrDirectory) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email");
  const days  = Math.min(365, Math.max(7, parseInt(searchParams.get("days") ?? "90", 10)));

  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("get_employee_performance_detail", {
    p_email: email,
    p_days:  days,
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
