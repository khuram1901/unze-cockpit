import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { sendNotificationEmail } from "../../../lib/send-email";

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();
    if (!email) return Response.json({ error: "Email required" }, { status: 400 });

    const supabase = createServiceClient();
    const { data: member } = await supabase
      .from("members")
      .select("first_name, last_name, name")
      .eq("email", email)
      .maybeSingle();

    const memberName = member
      ? `${member.first_name || ""} ${member.last_name || ""}`.trim() || member.name || email
      : email;

    const now = new Date();
    const timeStr = now.toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: "Asia/Karachi" });

    await sendNotificationEmail({
      to: email,
      subject: "Password Changed - Unze Pulse Dashboard",
      heading: "Your Password Was Changed",
      body: `
        <p>Hi <strong>${memberName}</strong>,</p>
        <p>Your password for the Unze Pulse Dashboard was successfully changed on <strong>${timeStr} (PKT)</strong>.</p>
        <p style="background:#fef2f2;padding:12px;border-radius:6px;border-left:3px solid #dc2626;font-size:14px">
          If you did not make this change, please contact your administrator immediately and reset your password.
        </p>
      `,
      linkUrl: process.env.NEXT_PUBLIC_APP_URL || "https://unze-cockpit.vercel.app",
      linkLabel: "Open Pulse Dashboard",
      triggerType: "password_changed",
      recipientName: memberName,
    });

    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
