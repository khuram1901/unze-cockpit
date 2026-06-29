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
      .order("created_at", { ascending: false });

    const accounts = (data || []).map((a) => ({
      email: a.user_email,
      lastUpdated: a.updated_at,
    }));

    return Response.json({
      connected: accounts.length > 0,
      email: accounts[0]?.email || null,
      lastUpdated: accounts[0]?.lastUpdated || null,
      accounts,
    });
  } catch {
    return Response.json({ connected: false, email: null, lastUpdated: null, accounts: [] });
  }
}
