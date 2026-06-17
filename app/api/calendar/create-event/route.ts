import { NextRequest } from "next/server";
import { getAuthenticatedClient } from "../../../lib/google-client";
import { google } from "googleapis";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, description, date, startTime, endTime, attendeeEmails } = body;

    if (!title || !date || !startTime || !endTime) {
      return Response.json(
        { error: "title, date, startTime, and endTime are required" },
        { status: 400 }
      );
    }

    const oauth2Client = await getAuthenticatedClient();
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const event = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: title,
        description: description || undefined,
        start: {
          dateTime: `${date}T${startTime}:00`,
          timeZone: "Asia/Karachi",
        },
        end: {
          dateTime: `${date}T${endTime}:00`,
          timeZone: "Asia/Karachi",
        },
        attendees: (attendeeEmails || []).map((email: string) => ({ email })),
      },
    });

    return Response.json({
      success: true,
      eventId: event.data.id,
      htmlLink: event.data.htmlLink,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
