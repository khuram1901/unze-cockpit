import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// GET — returns full admin summary jsonb from get_admin_summary() RPC.
// Any user with can_access_admin_ops permission may call this.
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("get_admin_summary");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ data });
}
