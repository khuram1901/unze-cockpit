import { NextRequest } from "next/server";
import { google } from "googleapis";
import { createServiceClient } from "../../../lib/supabase-server";
import { safeDecrypt } from "../../../lib/crypto";
import { requireAuth } from "../../../lib/api-auth";

// Temporary debug route — shows exactly what calendars and events Google returns
// Visit /api/calendar/debug?date=YYYY-MM-DD to inspect
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const dateParam = request.nextUrl.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(dateParam + "T00:00:00");
  weekEnd.setDate(weekEnd.getDate() + 7);
  const endDate = weekEnd.toISOString().slice(0, 10);
  const timeMin = `${dateParam}T00:00:00+05:00`;
  const timeMax = `${endDate}T23:59:59+05:00`;

  const supabase = createServiceClient();
  const { data: tokens } = await supabase.from("google_oauth_tokens").select("*").order("updated_at", { ascending: false });

  if (!tokens?.length) return Response.json({ error: "No tokens in DB" });

  const result = [];

  for (const tokenRow of tokens) {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({
      access_token: safeDecrypt(tokenRow.access_token),
      refresh_token: safeDecrypt(tokenRow.refresh_token),
      expiry_date: tokenRow.token_expiry ? new Date(tokenRow.token_expiry).getTime() : undefined,
    });

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    try {
      const calListRes = await calendar.calendarList.list();
      const allCals = calListRes.data.items || [];

      const calDebug = [];
      for (const c of allCals) {
        const included = !c.deleted && (c.accessRole === "owner" || c.accessRole === "writer")
          && !(c.id || "").includes("#holiday@")
          && !(c.id || "").includes("#contacts@")
          && !(c.id || "").includes("#weeknum@");

        let events: { title: string; start: string; end: string; filtered?: string }[] = [];
        let rawEventCount = 0;

        if (included) {
          try {
            const evRes = await calendar.events.list({
              calendarId: c.id || "primary",
              timeMin, timeMax,
              singleEvents: true,
              orderBy: "startTime",
              maxResults: 250,
            });
            const evItems = evRes.data.items || [];
            rawEventCount = evItems.length;

            for (const ev of evItems) {
              const filterReason =
                ev.status === "cancelled" ? "cancelled" :
                ev.eventType === "birthday" ? "birthday" :
                ev.eventType === "workingLocation" ? "workingLocation" :
                ev.transparency === "transparent" ? "marked-free" :
                null;

              const start = ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T00:00:00+05:00` : "");
              const end = ev.end?.dateTime || (ev.end?.date ? `${ev.end.date}T00:00:00+05:00` : "");

              events.push({
                title: ev.summary || "(no title)",
                start,
                end,
                ...(filterReason ? { filtered: filterReason } : {}),
              });
            }
          } catch (err) {
            events = [{ title: `ERROR: ${err instanceof Error ? err.message : String(err)}`, start: "", end: "" }];
          }
        }

        calDebug.push({
          id: c.id,
          name: c.summary,
          accessRole: c.accessRole,
          deleted: c.deleted || false,
          included,
          excludeReason: included ? null :
            c.deleted ? "deleted" :
            !(c.accessRole === "owner" || c.accessRole === "writer") ? `accessRole=${c.accessRole}` :
            "id-filter",
          rawEventCount,
          events,
        });
      }

      result.push({ account: tokenRow.user_email, tokenUpdated: tokenRow.updated_at, calendars: calDebug });
    } catch (err) {
      result.push({ account: tokenRow.user_email, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return Response.json({ dateRange: { from: dateParam, to: endDate }, accounts: result }, { status: 200 });
}
