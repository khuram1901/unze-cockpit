import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

/** POST /api/visitors/check-out
 * Records time_out for a visitor.
 * Body: { visitor_id: string, time_out?: string }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();

  const { data: member } = await supabase
    .from("members")
    .select("id")
    .eq("email", auth.email)
    .single();
  if (!member) return Response.json({ error: "Member not found" }, { status: 403 });

  const body = await request.json();
  const { visitor_id, time_out } = body;
  if (!visitor_id) return Response.json({ error: "visitor_id required" }, { status: 400 });

  // Use RPC so it gets audit-logged
  const { error } = await supabase.rpc("visitor_checkout", {
    p_visitor_id: visitor_id,
    p_time_out:   time_out || new Date().toISOString(),
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
