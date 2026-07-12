import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// The global HR inbox list, visible to every logged-in user. Split out
// from get_folderit_details (074/077) because that RPC's hr_inbox branch
// had no company filter and was leaking into every company's drill-down
// in the admin view — see migration 078.
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const db = createServiceClient();
  const { data, error } = await db.rpc("get_folderit_hr_inbox");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ items: data ?? [] });
}
