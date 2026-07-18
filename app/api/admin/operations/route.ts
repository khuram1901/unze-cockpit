import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// GET — ?type=fuel&year=2026 | ?type=solar&year=2026
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()), 10);

  const supabase = createServiceClient();

  if (type === "solar") {
    const { data, error } = await supabase.rpc("get_solar_summary", { p_year: year });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ data });
  }

  if (type === "utility") {
    const { data, error } = await supabase.rpc("get_utility_summary", { p_year: year });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ data });
  }

  // Default: fuel
  const { data, error } = await supabase.rpc("get_fuel_summary", { p_year: year });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ data });
}
