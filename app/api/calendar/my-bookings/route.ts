import { NextRequest } from "next/server";
import { google, type calendar_v3 } from "googleapis";
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

// A cancellable booking must be: on Khuram's own calendar (organizer.self),
// a 1:1 with the requester as the SOLE other attendee, AND carry the
// booking-page fingerprint — Google appointment-schedule events put a
// "Booked by" block (with the booker's details) in the description, which
// meetings Khuram schedules manually never have. Without this last check a
// user could cancel a 1:1 Khuram himself put in the diary.
type GEvent = {
  organizer?: { self?: boolean | null } | null;
  attendees?: GAttendee[] | null;
  description?: string | null;
};
function isMyBooking(ev: GEvent, me: string): boolean {
  if (!ev.organizer?.self) return false;
  if (soleOtherAttendee(ev.attendees || undefined) !== me) return false;
  const desc = (ev.description || "").toLowerCase();
  return desc.includes("booked by");
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const oauth2Client = await getAuthenticatedClient();
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const now = new Date();
    const max = new Date(now.getTime() + 90 * 24 * 3600 * 1000);
    const me = auth.email.toLowerCase();
    const bookings: Booking[] = [];
    // Paginate — with singleEvents:true recurring events expand into
    // instances, so 90 days can easily exceed one page.
    let pageToken: string | undefined = undefined;
    do {
      const { data }: { data: calendar_v3.Schema$Events } = await calendar.events.list({
        calendarId: "primary",
        timeMin: now.toISOString(),
        timeMax: max.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
        pageToken,
      });
      for (const ev of data.items || []) {
        if (!ev.id || ev.status === "cancelled") continue;
        if (!isMyBooking(ev, me)) continue;
        bookings.push({
          id: ev.id,
          title: ev.summary || "Meeting with Khuram Saleem",
          start: ev.start?.dateTime || ev.start?.date || "",
          end: ev.end?.dateTime || ev.end?.date || "",
          meetLink: ev.hangoutLink || undefined,
        });
      }
      pageToken = data.nextPageToken || undefined;
    } while (pageToken);
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
    let ev;
    try {
      ({ data: ev } = await calendar.events.get({ calendarId: "primary", eventId }));
    } catch (getErr) {
      const code = (getErr as { code?: number })?.code;
      if (code === 404 || code === 410) {
        return Response.json({ error: "This meeting no longer exists — it may already be cancelled." }, { status: 404 });
      }
      throw getErr;
    }
    if (!ev || ev.status === "cancelled") {
      return Response.json({ error: "This meeting no longer exists — it may already be cancelled." }, { status: 404 });
    }
    if (!isMyBooking(ev, auth.email.toLowerCase())) {
      return Response.json({ error: "This meeting isn't one of your bookings." }, { status: 403 });
    }
    // Past-event guard — all-day dates are interpreted in Pakistan time,
    // not UTC, so "today" doesn't flip five hours early.
    const startsAt = ev.start?.dateTime || ev.start?.date;
    const startMs = startsAt
      ? new Date(startsAt.includes("T") ? startsAt : `${startsAt}T00:00:00+05:00`).getTime()
      : null;
    if (startMs !== null && startMs < Date.now()) {
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
