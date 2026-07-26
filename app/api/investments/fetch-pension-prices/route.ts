import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

const CRON_SECRET = process.env.CRON_SECRET;

// Supabase Edge Function URL — this runs on Cloudflare Workers (different IP
// range than Vercel/AWS), which bypasses the Morningstar server-IP block.
const EDGE_FUNCTION_URL =
  "https://ffwdubfkcaoiyohscael.supabase.co/functions/v1/fetch-pension-prices";

export async function GET(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = request.headers.get("authorization") ?? "";
  const isCron = CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`;

  if (!isCron) {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;
    const db = createServiceClient();
    const { data: m } = await db
      .from("members")
      .select("role")
      .eq("email", (auth as { email: string }).email.toLowerCase())
      .maybeSingle();
    const role = m?.role ?? null;
    const isAdmin =
      (auth as { email: string }).email.toLowerCase() === "khuram1901@gmail.com" ||
      role === "Admin" ||
      role === "CEO";
    if (!isAdmin) return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Delegate to Supabase Edge Function (runs on Cloudflare, not AWS) ──────
  // The edge function has verify_jwt: true, so we authenticate with the
  // service role key which is a valid Supabase-signed JWT.
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return Response.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const edgeRes = await fetch(EDGE_FUNCTION_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(55_000), // Vercel function timeout is 60s
    });

    const body = await edgeRes.json();
    return Response.json(body, { status: edgeRes.status });
  } catch (err) {
    return Response.json(
      {
        error: "Edge function call failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
