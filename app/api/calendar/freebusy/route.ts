import { NextRequest } from "next/server";
import { getAuthenticatedClient } from "../../../lib/google-client";
import { google } from "googleapis";

export async function GET(request: NextRequest) {
  const dateParam = request.nextUrl.searchParams.get("date");
  if (!dateParam) {
    return Response.json({ error: "date parameter required (YYYY-MM-DD)" }, { status: 400 });
  }

  try {
    const oauth2Client = await getAuthenticatedClient();
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const startOfDay = `${dateParam}T00:00:00+05:00`;
    const endOfDay = `${dateParam}T23:59:59+05:00`;

    // Get free/busy for the week (7 days from the given date)
    const weekEnd = new Date(dateParam + "T00:00:00");
    weekEnd.setDate(weekEnd.getDate() + 7);
    const endDate = weekEnd.toISOString().slice(0, 10);

    const res = await calendar.freebusy.query({
      requestBody: {
        timeMin: `${dateParam}T00:00:00+05:00`,
        timeMax: `${endDate}T23:59:59+05:00`,
        items: [{ id: "primary" }],
      },
    });

    const busy = res.data.calendars?.primary?.busy || [];

    // Return only start/end times — NO event details (privacy rule)
    return Response.json({
      busy: busy.map((b) => ({
        start: b.start,
        end: b.end,
      })),
      dateRange: { from: dateParam, to: endDate },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
