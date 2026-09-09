import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();

  // Role gate (09/09/2026 access audit): receivables are financial data.
  // Mirrors the receivables RLS rule — Admin/CEO + Finance/Ops Managers.
  // PA (Executive) never sees financial data (CLAUDE.md rule 6).
  const { data: member } = await supabase
    .from("members")
    .select("role, department")
    .eq("email", auth.email)
    .maybeSingle();
  const role = member?.role ?? "";
  const dept = member?.department ?? "";
  const allowed =
    role === "Admin" || role === "CEO" ||
    (role === "Manager" && (dept === "Finance" || dept === "Unze Trading Ops"));
  if (!allowed) return Response.json({ error: "Forbidden" }, { status: 403 });
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("q") || "";

  const { data, error } = await supabase.rpc("search_receivables_for_guarantee", { p_search: search });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ bills: data || [] });
}
