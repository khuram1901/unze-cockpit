import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// Visible to every logged-in user — HR categories (Policies & SOPs, etc.).
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const db = createServiceClient();
  const { data, error } = await db.rpc("get_folderit_hr_categories");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ categories: data ?? [] });
}
