import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("get_facility_synopsis");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // get_facility_synopsis returns jsonb — data is the parsed value (array or null)
  const banks = Array.isArray(data) ? data : [];
  return Response.json({ banks });
}
