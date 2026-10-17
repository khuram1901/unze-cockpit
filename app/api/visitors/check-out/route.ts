import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../lib/api-auth";

/** POST /api/visitors/check-out
 * Records time_out for a visitor.
 * Body: { visitor_id: string, time_out?: string }
 *
 * IMPORTANT: Must use the user's JWT (not service role) so that
 * auth.email() resolves correctly inside the visitor_checkout Postgres
 * function. Service role → auth.email() returns NULL → "Not authenticated".
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const { visitor_id, time_out } = body;
  if (!visitor_id) return Response.json({ error: "visitor_id required" }, { status: 400 });

  // Use the user's JWT so auth.email() works inside visitor_checkout
  const authHeader = request.headers.get("authorization");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader! } } },
  );

  // Use RPC so it gets audit-logged
  const { error } = await supabase.rpc("visitor_checkout", {
    p_visitor_id: visitor_id,
    p_time_out:   time_out || new Date().toISOString(),
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
