import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// Fiscal year start year: if current month >= July, return this year; else last year.
// e.g. in March 2026 → 2025 (FY 2025-26); in September 2026 → 2026 (FY 2026-27).
function currentFyStart(): number {
  const now = new Date();
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

// GET — ?type=fuel&year=2025 | ?type=solar&year=2025
// year = FY start year (July year), e.g. 2025 → Jul 2025 – Jun 2026
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const year = parseInt(searchParams.get("year") || String(currentFyStart()), 10);

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
