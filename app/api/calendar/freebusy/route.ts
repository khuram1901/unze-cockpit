import { NextRequest } from "next/server";
import { google } from "googleapis";
import { createServiceClient } from "../../../lib/supabase-server";
import { safeDecrypt, encrypt } from "../../../lib/crypto";
import { htmlToText, extractMeeting, dedupe, type CalendarEvent } from "../eventUtils";

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
      .select("id, user_email, access_token, refresh_token, token_expiry, created_at")
      .eq("user_email", auth.email)
      .order("created_at");

    if (!tokens || tokens.length === 0) {
      return Response.json({ busy: [], accounts: 0, dateRange: { from: dateParam, to: endDate }, debug: "no_tokens" });
    }

    const allBusy: CalendarEvent[] = [];
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
        const calendars = (calendarList.data.items || [])
          .filter((c) => !c.deleted && (c.accessRole === "owner" || c.accessRole === "writer"))
          .filter((c) => !(c.id || "").includes("#holiday@") && !(c.id || "").includes("#contacts@") && !(c.id || "").includes("#weeknum@"))
          .map((c) => ({ id: c.id || "primary", name: c.summaryOverride || c.summary || undefined }));

        let eventCount = 0;
        for (const cal of calendars) {
          try {
            const eventsRes = await calendar.events.list({
              calendarId: cal.id,
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
              const allDay = !ev.start?.dateTime && !!ev.start?.date;
              const start = ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T00:00:00+05:00` : undefined);
              const end = ev.end?.dateTime || (ev.end?.date ? `${ev.end.date}T00:00:00+05:00` : undefined);
              if (!start || !end) continue;

              const description = htmlToText(ev.description);
              const meeting = extractMeeting({
                conferenceData: ev.conferenceData,
                hangoutLink: ev.hangoutLink,
                location: ev.location,
                description,
              });
              const attendees = (ev.attendees || [])
                .filter((a) => !a.resource)
                .map((a) => ({
                  email: a.email || undefined,
                  name: a.displayName || undefined,
                  response: a.responseStatus || undefined,
                  self: a.self || undefined,
                }));

              allBusy.push({
                start,
                end,
                title: ev.summary || "Busy",
                account: tokenRow.user_email,
                id: ev.id || undefined,
                uid: ev.iCalUID || undefined,
                allDay,
                description,
                // A location that is only the meeting URL is noise once we
                // surface a Join button, so drop it.
                location: ev.location && ev.location !== meeting.meetingLink ? ev.location : undefined,
                organizer: ev.organizer?.email
                  ? { email: ev.organizer.email, name: ev.organizer.displayName || undefined }
                  : undefined,
                attendees: attendees.length ? attendees : undefined,
                ...meeting,
                htmlLink: ev.htmlLink || undefined,
                calendarName: cal.name,
                recurring: !!ev.recurringEventId,
                myResponse: (ev.attendees || []).find((a) => a.self)?.responseStatus || undefined,
                duplicateCount: 1,
              });
              eventCount++;
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

    // The same meeting can land on several calendars (primary + a shared team
    // calendar, an invite accepted on two calendars, etc). Collapse those into
    // one entry, keeping the richest copy.
    const { events: busy, removed } = dedupe(allBusy);
    busy.sort((a, b) => a.start.localeCompare(b.start));

    return Response.json({
      busy,
      accounts: tokens.length,
      accountResults,
      duplicatesRemoved: removed,
      rawCount: allBusy.length,
      dateRange: { from: dateParam, to: endDate },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
