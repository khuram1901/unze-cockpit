import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

/** GET /api/visitors/lookup
 * Autofill returning visitor data by CNIC or mobile.
 * Returns visitor details + flag status.
 * Query: cnic or mobile (one required)
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const sp = request.nextUrl.searchParams;
  const cnic   = sp.get("cnic")   || null;
  const mobile = sp.get("mobile") || null;

  if (!cnic && !mobile) {
    return Response.json({ error: "cnic or mobile required" }, { status: 400 });
  }

  const cnicClean = cnic ? cnic.replace(/[-\s]/g, "") : null;

  const { data, error } = await supabase.rpc("lookup_visitor", {
    p_cnic:   cnicClean,
    p_mobile: mobile,
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
