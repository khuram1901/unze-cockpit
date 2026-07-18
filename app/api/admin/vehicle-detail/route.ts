import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// Fiscal year start: month >= July → this year, else last year.
function currentFyStart(): number {
  const now = new Date();
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

// GET — ?vehicleId=UUID&year=2025
// year = FY start year (July year), e.g. 2025 → Jul 2025 – Jun 2026
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const vehicleId = searchParams.get("vehicleId");
  const year = parseInt(searchParams.get("year") || String(currentFyStart()), 10);

  if (!vehicleId) return Response.json({ error: "vehicleId required" }, { status: 400 });

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("get_vehicle_detail", {
    p_vehicle_id: vehicleId,
    p_year: year,
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ data });
}
