import { NextRequest } from "next/server";
import { google } from "googleapis";
import { getAuthenticatedClient } from "../../../lib/google-client";
import { requireAuth } from "../../../lib/api-auth";

// "My meetings with Khuram" — lets any signed-in user see and cancel the
// meetings they booked through the welcome page's Google booking links.
//
// Safety model: bookings made through calendar.app.google land on Khuram's
// primary calendar as 1:1 events (organizer = Khuram's integration account,
// exactly ONE other attendee = the booker). Both list and cancel require
// that exact shape with the requester as that sole attendee — so a user can
// only ever see/cancel their own 1:1 bookings, never board meetings or
// anyone else's slots. Cancelling deletes the event with sendUpdates=all,
// so Google emails the cancellation to both sides.

type Booking = {
  id: string;
  title: string;
  start: string;      // ISO datetime (or date for all-day)
  end: string;
  meetLink?: string;
};

// Google's attendee entry for the organizer carries organizer/self flags;
// the booker is the one remaining attendee.
type GAttendee = { email?: string | null; organizer?: boolean | null; self?: boolean | null; resource?: boolean | null };

function soleOtherAttendee(attendees: GAttendee[] | undefined): string | null {
  if (!attendees) return null;
  const others = attendees.filter((a) => !a.organizer && !a.self && !a.resource && a.email);
  if (others.length !== 1) return null;
  return (others[0].email || "").toLowerCase();
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const oauth2Client = await getAuthenticatedClient();
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const now = new Date();
    const max = new Date(now.getTime() + 90 * 24 * 3600 * 1000);
    const { data } = await calendar.events.list({
      calendarId: "primary",
      timeMin: now.toISOString(),
      timeMax: max.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
    });

    const me = auth.email.toLowerCase();
    const bookings: Booking[] = [];
    for (const ev of data.items || []) {
      if (!ev.id || ev.status === "cancelled") continue;
      if (!ev.organizer?.self) continue; // must live on Khuram's own calendar
      if (soleOtherAttendee(ev.attendees as GAttendee[]) !== me) continue;
      bookings.push({
        id: ev.id,
        title: ev.summary || "Meeting with Khuram Saleem",
        start: ev.start?.dateTime || ev.start?.date || "",
        end: ev.end?.dateTime || ev.end?.date || "",
        meetLink: ev.hangoutLink || undefined,
      });
    }
    return Response.json({ bookings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // The integration token may be missing/expired — the UI shows this text.
    return Response.json({ error: "Could not load your meetings: " + message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  let eventId: string;
  try {
    const body = await request.json();
    eventId = String(body.eventId || "");
    if (!eventId || eventId.length > 200) throw new Error("bad id");
  } catch {
    return Response.json({ error: "eventId is required." }, { status: 400 });
  }

  try {
    const oauth2Client = await getAuthenticatedClient();
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    // Re-verify server-side that this event is THIS user's 1:1 booking —
    // never trust the id alone.
    const { data: ev } = await calendar.events.get({ calendarId: "primary", eventId });
    if (!ev || ev.status === "cancelled") {
      return Response.json({ error: "This meeting no longer exists — it may already be cancelled." }, { status: 404 });
    }
    if (!ev.organizer?.self || soleOtherAttendee(ev.attendees as GAttendee[]) !== auth.email.toLowerCase()) {
      return Response.json({ error: "This meeting isn't one of your bookings." }, { status: 403 });
    }
    const startsAt = ev.start?.dateTime || ev.start?.date;
    if (startsAt && new Date(startsAt).getTime() < Date.now()) {
      return Response.json({ error: "This meeting has already started or passed." }, { status: 400 });
    }

    // Delete with notifications — Google emails the cancellation to both
    // Khuram and the booker.
    await calendar.events.delete({ calendarId: "primary", eventId, sendUpdates: "all" });
    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: "Could not cancel the meeting: " + message }, { status: 500 });
  }
}
