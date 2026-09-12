import { NextRequest } from "next/server";
import { createServiceClient } from "../../../../lib/supabase-server";
import { requireAuth, getMemberAccess } from "../../../../lib/api-auth";

// GET /api/hr/recruitment/overview
// Returns recruitment positions + candidate pipeline from get_recruitment_overview() RPC.
// Access: HR department, admins, and executives.
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const access = await getMemberAccess(auth.email);
  if (!access.hrDirectory) return Response.json({ error: "Forbidden" }, { status: 403 });

  const db = createServiceClient();
  const { data, error } = await db.rpc("get_recruitment_overview");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
