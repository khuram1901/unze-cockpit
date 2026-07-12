import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { canViewFolderitHr } from "../../../lib/permissions";
import { loadFolderitUserCtx } from "../_shared";

// HR categories (Policies & SOPs, etc.) — locked behind can_view_folderit_hr.
// Off by default for everyone except Admin/CEO; granted per-member via
// Members > Access Matrix > Folderit > HR.
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const email = (auth as { email: string }).email.toLowerCase();

  const db = createServiceClient();
  const ctx = await loadFolderitUserCtx(db, email);
  if (!canViewFolderitHr(ctx)) return Response.json({ categories: [] });

  const { data, error } = await db.rpc("get_folderit_hr_categories");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ categories: data ?? [] });
}
