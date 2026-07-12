import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// Admin/CEO only — cross-company list of documents that have been sitting
// (unfiled, or pending approval) for 7+ days, for the alert banner at the
// top of the CEO's Folderit view.
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const email = (auth as { email: string }).email.toLowerCase();

  const db = createServiceClient();
  const { data: member } = await db
    .from("members")
    .select("role")
    .eq("email", email)
    .maybeSingle();

  const isAdmin =
    email === "khuram1901@gmail.com" ||
    member?.role === "Admin" ||
    member?.role === "CEO";

  if (!isAdmin) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await db.rpc("get_folderit_overdue_items", { p_threshold_days: 7 });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ items: data ?? [] });
}
