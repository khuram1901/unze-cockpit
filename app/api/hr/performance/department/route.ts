import { NextRequest } from "next/server";
import { createServiceClient } from "../../../../lib/supabase-server";
import { requireAuth } from "../../../../lib/api-auth";

// GET /api/hr/performance/department?department=Operations&company=Unze+Group&days=90
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const department = searchParams.get("department") ?? "";
  const company    = searchParams.get("company")    ?? "";
  const days       = Math.min(365, Math.max(7, parseInt(searchParams.get("days") ?? "90", 10)));
  if (!department || !company) return Response.json({ error: "department and company are required" }, { status: 400 });

  const db = createServiceClient();
  const { data, error } = await db.rpc("get_hr_department_performance", {
    p_department: department, p_company: company, p_days: days,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
