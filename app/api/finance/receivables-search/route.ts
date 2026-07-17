import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("q") || "";

  const { data, error } = await supabase.rpc("search_receivables_for_guarantee", { p_search: search });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ bills: data || [] });
}
