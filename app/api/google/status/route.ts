import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("google_oauth_tokens")
      .select("user_email, updated_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    return Response.json({
      connected: !!data,
      email: data?.user_email || null,
      lastUpdated: data?.updated_at || null,
    });
  } catch {
    return Response.json({ connected: false, email: null, lastUpdated: null });
  }
}
