/**
 * GET /api/daily-sales/my-store
 *
 * Returns the store record assigned to the authenticated store user.
 * Store users are matched by email pattern store###@unze.co.uk.
 *
 * Returns: { id: string, name: string, fm_code: string }
 * or 404 if the caller is not a store user or has no store assignment.
 *
 * Admins get { id: null, name: null, fm_code: null } so the mobile
 * form can handle them gracefully (they need a store selector).
 */
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../lib/api-auth";

const STORE_USER_RE = /^store(\d{3})@unze\.co\.uk$/i;

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const match = STORE_USER_RE.exec(auth.email);

  if (!match) {
    // Admin/HOD — no single store
    return Response.json({ id: null, name: null, fm_code: null });
  }

  const fmCode = match[1]; // e.g. "001"

  const sc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await sc
    .from("stores")
    .select("id, name, fm_code")
    .eq("fm_code", fmCode)
    .single();

  if (error || !data) {
    return Response.json(
      { error: `No store found for FM code ${fmCode}` },
      { status: 404 }
    );
  }

  return Response.json({ id: data.id, name: data.name, fm_code: data.fm_code });
}
