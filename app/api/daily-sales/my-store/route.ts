/**
 * GET /api/daily-sales/my-store
 *
 * Returns the store record assigned to the authenticated store user.
 * Store assignment is resolved server-side via retail_store_for_user() RPC,
 * which requires:
 *   - An active store_users row for the caller's auth.uid()
 *   - is_primary = true
 *   - store is active
 *   - store.email matches the caller's JWT email (case-insensitive)
 *
 * Returns: { id: string, name: string, fm_code: string }
 *   or { id: null, name: null, fm_code: null } for HOD/FM/admin callers
 *   or 404 if the store is in the DB but fetch fails.
 *
 * The RPC is called with the user's own JWT so RLS and auth.email() apply
 * correctly — NOT with the service role.
 */
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../lib/api-auth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const authHeader = request.headers.get("authorization") ?? "";

  // Use the caller's JWT client so auth.uid() and auth.email() are set correctly
  const uc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } }
  );

  // Resolve store server-side — never trust client-sent store_id here
  const { data: storeId, error: rpcError } = await uc.rpc("retail_store_for_user");

  if (rpcError) {
    console.error("[daily-sales/my-store] retail_store_for_user RPC error:", rpcError);
    return Response.json({ error: rpcError.message }, { status: 500 });
  }

  if (!storeId) {
    // HOD/FM/admin or store user whose store isn't matched — return null sentinel
    return Response.json({ id: null, name: null, fm_code: null });
  }

  // Fetch store details using service client (RLS already enforced via RPC above)
  const sc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await sc
    .from("stores")
    .select("id, name, fm_code")
    .eq("id", storeId)
    .single();

  if (error || !data) {
    return Response.json(
      { error: `Store record not found for resolved store_id ${storeId}` },
      { status: 404 }
    );
  }

  return Response.json({ id: data.id, name: data.name, fm_code: data.fm_code });
}
