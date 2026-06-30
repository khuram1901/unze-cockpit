import { NextRequest } from "next/server";
import { google } from "googleapis";
import { createServiceClient } from "../../../lib/supabase-server";
import { safeDecrypt, encrypt } from "../../../lib/crypto";

export async function GET(request: NextRequest) {
  const { requireAuth } = await import("../../../lib/api-auth");
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

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

    const supabase = createServiceClient();
    const { data: tokens } = await supabase
      .from("google_oauth_tokens")
      .select("*")
      .order("created_at");

    if (!tokens || tokens.length === 0) {
      return Response.json({ busy: [], accounts: 0, dateRange: { from: dateParam, to: endDate }, debug: "no_tokens" });
    }

    const allBusy: { start: string; end: string; title?: string; account?: string }[] = [];
    const accountResults: { email: string; status: string; busyCount: number; error?: string }[] = [];

    for (const tokenRow of tokens) {
      try {
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI
        );

        const accessToken = safeDecrypt(tokenRow.access_token);
        const refreshToken = safeDecrypt(tokenRow.refresh_token);

        oauth2Client.setCredentials({
          access_token: accessToken,
          refresh_token: refreshToken,
          expiry_date: tokenRow.token_expiry ? new Date(tokenRow.token_expiry).getTime() : undefined,
        });

        oauth2Client.on("tokens", async (newTokens) => {
          const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
          if (newTokens.access_token) updates.access_token = encrypt(newTokens.access_token);
          if (newTokens.refresh_token) updates.refresh_token = encrypt(newTokens.refresh_token);
          if (newTokens.expiry_date) updates.token_expiry = new Date(newTokens.expiry_date).toISOString();
          await supabase.from("google_oauth_tokens").update(updates).eq("id", tokenRow.id);
        });

        const calendar = google.calendar({ version: "v3", auth: oauth2Client });

        // Only the account's own scheduling calendars — exclude Holidays,
        // Birthdays, and other auto-subscribed calendars Google adds to every
        // account, which have accessRole "reader" and aren't real meetings.
        const calendarList = await calendar.calendarList.list();
        const calendarIds = (calendarList.data.items || [])
          .filter((c) => !c.deleted && (c.accessRole === "owner" || c.accessRole === "writer"))
          .filter((c) => !(c.id || "").includes("#holiday@") && !(c.id || "").includes("#contacts@") && !(c.id || "").includes("#weeknum@"))
          .map((c) => c.id || "primary");

        let eventCount = 0;
        for (const calId of calendarIds) {
          try {
            const eventsRes = await calendar.events.list({
              calendarId: calId,
              timeMin,
              timeMax,
              singleEvents: true,
              orderBy: "startTime",
              maxResults: 250,
            });

            for (const ev of eventsRes.data.items || []) {
              if (ev.status === "cancelled") continue;
              if (ev.eventType === "birthday" || ev.eventType === "workingLocation") continue;
              if (ev.transparency === "transparent") continue; // marked "Free" on Google Calendar
              // All-day events come back as bare dates (no time/offset); anchor
              // them to Pakistan time so they don't shift relative to UTC.
              const start = ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T00:00:00+05:00` : undefined);
              const end = ev.end?.dateTime || (ev.end?.date ? `${ev.end.date}T00:00:00+05:00` : undefined);
              if (start && end) {
                allBusy.push({ start, end, title: ev.summary || "Busy", account: tokenRow.user_email });
                eventCount++;
              }
            }
          } catch {
            // skip calendars we can't read
          }
        }

        accountResults.push({
          email: tokenRow.user_email,
          status: "ok",
          busyCount: eventCount,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        accountResults.push({ email: tokenRow.user_email, status: "failed", busyCount: 0, error: msg });
      }
    }

    return Response.json({
      busy: allBusy,
      accounts: tokens.length,
      accountResults,
      dateRange: { from: dateParam, to: endDate },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
