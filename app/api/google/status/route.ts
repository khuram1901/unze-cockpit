import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  try {
    const supabase = createServiceClient();

    // Mirror the same logic as send-email.ts: prefer NOTIFICATION_GMAIL if set
    const notificationEmail = process.env.NOTIFICATION_GMAIL?.toLowerCase();
    const query = supabase
      .from("google_oauth_tokens")
      .select("user_email, updated_at");

    const { data: notifRow } = notificationEmail
      ? await query.ilike("user_email", notificationEmail).limit(1).single()
      : await query.order("updated_at", { ascending: false }).limit(1).single();

    // Also return all accounts for reference
    const { data: allData } = await supabase
      .from("google_oauth_tokens")
      .select("user_email, updated_at")
      .order("updated_at", { ascending: false });

    const accounts = (allData || []).map((a) => ({
      email: a.user_email,
      lastUpdated: a.updated_at,
    }));

    return Response.json({
      connected: !!notifRow,
      email: notifRow?.user_email || null,
      lastUpdated: notifRow?.updated_at || null,
      accounts,
    });
  } catch {
    return Response.json({ connected: false, email: null, lastUpdated: null, accounts: [] });
  }
}
