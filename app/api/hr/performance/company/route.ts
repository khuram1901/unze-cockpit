import { NextRequest } from "next/server";
import { createServiceClient } from "../../../../lib/supabase-server";
import { requireAuth } from "../../../../lib/api-auth";

// GET /api/hr/performance/company?company=Unze+Group&days=90
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") ?? "";
  const days    = Math.min(365, Math.max(7, parseInt(searchParams.get("days") ?? "90", 10)));
  if (!company) return Response.json({ error: "company is required" }, { status: 400 });

  const db = createServiceClient();
  const { data, error } = await db.rpc("get_hr_company_performance", { p_company: company, p_days: days });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
