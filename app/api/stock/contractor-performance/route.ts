import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const plantId = searchParams.get("plantId");

  if (!plantId) return Response.json({ error: "plantId is required" }, { status: 400 });

  const { data, error } = await supabase.rpc("get_contractor_performance", { p_plant_id: plantId });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ performance: data || [] });
}
