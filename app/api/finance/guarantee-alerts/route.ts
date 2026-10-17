import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { resolveGuaranteePerms } from "../../../lib/guarantee-access";

// Lean overdue/due-soon guarantee alerts for the executive dashboard and the
// Bank Facilities page's own top banner. See migration 097 for the urgency
// logic (must stay in sync with get_guarantee_summary's chase_urgency).
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  // 17/10/2026: this route had no role gate — any signed-in user could pull
  // customer names and PKR amounts. Same view rule as the page itself;
  // /home ignores a non-OK response, so a 403 is harmless there.
  const { canView } = await resolveGuaranteePerms(auth.email);
  if (!canView) return Response.json({ error: "Forbidden" }, { status: 403 });

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("get_guarantee_alerts");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json(data ?? { overdue_count: 0, due_soon_count: 0, overdue: [], due_soon: [] });
}
