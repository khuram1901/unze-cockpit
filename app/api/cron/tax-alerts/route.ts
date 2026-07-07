import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { computeAndStoreTaxAlerts } from "../../../lib/taxAlertEngine";

function currentFiscalYear(): string {
  const m = new Date().getMonth() + 1;
  const y = new Date().getFullYear();
  return m >= 7 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`;
}

// GET — Vercel cron (Bearer CRON_SECRET)
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const taxYear  = currentFiscalYear();
    const result   = await computeAndStoreTaxAlerts(supabase, taxYear);
    return Response.json({ success: true, taxYear, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

// POST — fire-and-forget from AccountsTaxDashboard after each save (auth via Supabase session)
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const supabase = createServiceClient();
    const taxYear  = currentFiscalYear();
    const result   = await computeAndStoreTaxAlerts(supabase, taxYear);
    return Response.json({ success: true, taxYear, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
