import { NextRequest } from "next/server";
import { google } from "googleapis";
import { createServiceClient } from "../../../lib/supabase-server";

export async function GET(request: NextRequest) {
  const dateParam = request.nextUrl.searchParams.get("date");
  if (!dateParam) {
    return Response.json({ error: "date parameter required (YYYY-MM-DD)" }, { status: 400 });
  }

  try {
    const weekEnd = new Date(dateParam + "T00:00:00");
    weekEnd.setDate(weekEnd.getDate() + 7);
    const endDate = weekEnd.toISOString().slice(0, 10);

    const timeMin = `${dateParam}T00:00:00+05:00`;
    const timeMax = `${endDate}T23:59:59+05:00`;

    // Fetch ALL connected Google accounts
    const supabase = createServiceClient();
    const { data: tokens } = await supabase
      .from("google_oauth_tokens")
      .select("*")
      .order("created_at");

    if (!tokens || tokens.length === 0) {
      return Response.json({ busy: [], dateRange: { from: dateParam, to: endDate } });
    }

    const allBusy: { start: string; end: string }[] = [];

    for (const tokenRow of tokens) {
      try {
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI
        );
        oauth2Client.setCredentials({
          access_token: tokenRow.access_token,
          refresh_token: tokenRow.refresh_token,
          expiry_date: tokenRow.token_expiry ? new Date(tokenRow.token_expiry).getTime() : undefined,
        });

        // Auto-refresh tokens
        oauth2Client.on("tokens", async (newTokens) => {
          const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
          if (newTokens.access_token) updates.access_token = newTokens.access_token;
          if (newTokens.expiry_date) updates.token_expiry = new Date(newTokens.expiry_date).toISOString();
          await supabase.from("google_oauth_tokens").update(updates).eq("id", tokenRow.id);
        });

        const calendar = google.calendar({ version: "v3", auth: oauth2Client });
        const res = await calendar.freebusy.query({
          requestBody: { timeMin, timeMax, items: [{ id: "primary" }] },
        });

        const busy = res.data.calendars?.primary?.busy || [];
        for (const b of busy) {
          if (b.start && b.end) allBusy.push({ start: b.start, end: b.end });
        }
      } catch {
        // Skip failed accounts silently — other accounts still contribute
      }
    }

    // Return only start/end times — NO event details (privacy rule)
    return Response.json({
      busy: allBusy,
      accounts: tokens.length,
      dateRange: { from: dateParam, to: endDate },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
