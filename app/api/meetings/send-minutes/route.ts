import { NextRequest } from "next/server";
import { sendNotificationEmail } from "../../../lib/send-email";

export async function POST(request: NextRequest) {
  try {
    const { meetingTitle, meetingDate, executiveSummary, decisions, actionItems, attendeeEmails } = await request.json();

    if (!attendeeEmails || attendeeEmails.length === 0) {
      return Response.json({ error: "No attendee emails provided" }, { status: 400 });
    }

    const decisionsHtml = decisions && decisions.length > 0
      ? `<p><strong>Decisions:</strong></p><ul>${decisions.map((d: string) => `<li>${d}</li>`).join("")}</ul>`
      : "";

    const actionsHtml = actionItems && actionItems.length > 0
      ? `<p><strong>Action Items:</strong></p><ul>${actionItems.map((a: { description: string; owner_name: string; due_date?: string; priority: string }) =>
          `<li><strong>${a.description}</strong> - ${a.owner_name}${a.due_date ? ` (due ${a.due_date})` : ""} [${a.priority}]</li>`
        ).join("")}</ul>`
      : "";

    let sent = 0;
    for (const email of attendeeEmails) {
      await sendNotificationEmail({
        to: email,
        subject: `Meeting Minutes - ${meetingTitle} (${meetingDate})`,
        heading: meetingTitle,
        body: `
          <p><strong>Date:</strong> ${meetingDate}</p>
          <p><strong>Summary:</strong></p>
          <p style="background:#f1f5f9;padding:12px;border-radius:6px">${executiveSummary}</p>
          ${decisionsHtml}
          ${actionsHtml}
        `,
        linkUrl: process.env.NEXT_PUBLIC_APP_URL || "https://unze-cockpit.vercel.app",
        linkLabel: "Open Pulse Dashboard",
        triggerType: "meeting_minutes",
        recipientName: email,
      });
      sent++;
    }

    return Response.json({ success: true, sent });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
