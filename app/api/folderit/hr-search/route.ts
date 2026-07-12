import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { canViewFolderitHr } from "../../../lib/permissions";
import { loadFolderitUserCtx } from "../_shared";

// Name search across HR documents (categorised files + the general HR
// inbox), for the search box at the top of the HR section on /folderit.
// Locked behind can_view_folderit_hr, same as every other HR route —
// search results are just another way to see the same documents.
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const email = (auth as { email: string }).email.toLowerCase();

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json({ items: [] });

  const db = createServiceClient();
  const ctx = await loadFolderitUserCtx(db, email);
  if (!canViewFolderitHr(ctx)) return Response.json({ items: [] });

  const { data, error } = await db.rpc("search_folderit_hr_files", { p_query: q });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ items: data ?? [] });
}
