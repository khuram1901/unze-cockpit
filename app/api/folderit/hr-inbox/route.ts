import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { canViewFolderitHr } from "../../../lib/permissions";
import { loadFolderitUserCtx } from "../_shared";

// The global HR inbox list. Split out from get_folderit_details (074/077)
// because that RPC's hr_inbox branch had no company filter and was leaking
// into every company's drill-down in the admin view — see migration 078.
// Locked behind can_view_folderit_hr, same as every other HR document list.
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const email = (auth as { email: string }).email.toLowerCase();

  const db = createServiceClient();
  const ctx = await loadFolderitUserCtx(db, email);
  if (!canViewFolderitHr(ctx)) return Response.json({ items: [] });

  const { data, error } = await db.rpc("get_folderit_hr_inbox");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ items: data ?? [] });
}
