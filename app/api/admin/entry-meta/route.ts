// Returns dropdown data for the Daily Entry page:
// vehicles, solar branches, and locations — all in one call.
import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();

  const [vehicles, branches, locations] = await Promise.all([
    supabase.rpc("get_active_vehicles"),
    supabase.rpc("get_active_solar_branches"),
    supabase.rpc("get_active_locations"),
  ]);

  if (vehicles.error) return Response.json({ error: vehicles.error.message }, { status: 500 });
  if (branches.error) return Response.json({ error: branches.error.message }, { status: 500 });
  if (locations.error) return Response.json({ error: locations.error.message }, { status: 500 });

  return Response.json({
    vehicles: vehicles.data,
    branches: branches.data,
    locations: locations.data,
  });
}
