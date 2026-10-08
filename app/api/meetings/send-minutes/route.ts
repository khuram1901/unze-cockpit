import { NextRequest } from "next/server";
import { sendNotificationEmail } from "../../../lib/send-email";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

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
          `<li><strong>${a.description}</strong> - ${a.owner_name}${a.due_date ? ` (due ${a.due_date.split("-").reverse().join("/")})` : ""} [${a.priority}]</li>`
        ).join("")}</ul>`
      : "";

    // Look up member prefs for all attendees in one query so we can gate on
    // notify_email AND notif_meetings before sending each email.
    const supabase = createServiceClient();
    const { data: members } = await supabase
      .from("members")
      .select("email, first_name, last_name, name, notify_email, notif_meetings")
      .in("email", attendeeEmails);

    const memberMap = new Map((members || []).map((m) => [m.email.toLowerCase(), m]));

    let sent = 0;
    let skipped = 0;
    for (const email of attendeeEmails) {
      const member = memberMap.get(email.toLowerCase());
      // Skip if member has master email toggle off OR meeting notifications off.
      // Non-members (email not in members table) are always sent — they have no prefs.
      if (member && (!member.notify_email || !member.notif_meetings)) {
        skipped++;
        continue;
      }

      const recipientName = member
        ? (`${member.first_name || ""} ${member.last_name || ""}`.trim() || member.name || email)
        : email;

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
        linkLabel: "Open Unze Group Dashboard",
        triggerType: "meeting_minutes",
        recipientName,
      });
      sent++;
    }

    return Response.json({ success: true, sent, skipped });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
