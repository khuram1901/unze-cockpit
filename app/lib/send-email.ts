import { google } from "googleapis";
import { getAuthenticatedClient } from "./google-client";
import { createServiceClient } from "./supabase-server";

function buildWhatsAppLink(phone: string, message: string): string {
  const encoded = encodeURIComponent(message);
  return `https://wa.me/${phone.replace(/[^0-9]/g, "")}?text=${encoded}`;
}

function buildEmailHtml({
  heading,
  body,
  linkUrl,
  linkLabel,
  whatsAppPhone,
  whatsAppMessage,
}: {
  heading: string;
  body: string;
  linkUrl: string;
  linkLabel: string;
  whatsAppPhone?: string | null;
  whatsAppMessage?: string;
}) {
  const whatsAppButton = whatsAppPhone && whatsAppMessage
    ? `<p style="margin-top:16px"><a href="${buildWhatsAppLink(whatsAppPhone, whatsAppMessage)}" style="background:#25D366;color:white;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px">Open in WhatsApp</a></p>`
    : "";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;background:#f3f5f8;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:white;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">
    <div style="background:#1e293b;padding:16px 20px">
      <h1 style="margin:0;color:white;font-size:18px;font-weight:700">Unze Group Cockpit</h1>
    </div>
    <div style="padding:20px">
      <h2 style="color:#1e293b;font-size:16px;margin:0 0 12px">${heading}</h2>
      <div style="color:#334155;font-size:14px;line-height:1.6">${body}</div>
      <p style="margin-top:20px">
        <a href="${linkUrl}" style="background:#2563eb;color:white;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px">${linkLabel}</a>
      </p>
      ${whatsAppButton}
    </div>
    <div style="background:#f8fafc;padding:12px 20px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px">
      Unze Group Cockpit · Automated notification
    </div>
  </div>
</body>
</html>`;
}

function buildRawEmail(to: string, from: string, subject: string, htmlBody: string): string {
  const boundary = "boundary_" + Date.now();
  const raw = [
    `From: Unze Cockpit (No Reply) <${from}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    htmlBody,
    ``,
    `--${boundary}--`,
  ].join("\r\n");

  return Buffer.from(raw).toString("base64url");
}

export async function sendNotificationEmail({
  to,
  subject,
  heading,
  body,
  linkUrl,
  linkLabel,
  triggerType,
  triggerRecordId,
  recipientName,
  whatsAppPhone,
  whatsAppMessage,
}: {
  to: string;
  subject: string;
  heading: string;
  body: string;
  linkUrl: string;
  linkLabel: string;
  triggerType: string;
  triggerRecordId?: string;
  recipientName?: string;
  whatsAppPhone?: string | null;
  whatsAppMessage?: string;
}) {
  try {
    // Use the notification-specific Gmail account (unzegrouppk@gmail.com)
    const supabaseForTokens = createServiceClient();
    const { data: notifToken } = await supabaseForTokens
      .from("google_oauth_tokens")
      .select("*")
      .eq("user_email", "unzegrouppk@gmail.com")
      .single();

    if (!notifToken) {
      console.error("Notification Gmail not connected. Connect via /api/google/auth-notifications");
      return { success: false, error: "Notification Gmail not connected" };
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      (process.env.GOOGLE_REDIRECT_URI || "").replace("/callback", "/callback-notifications")
    );
    oauth2Client.setCredentials({
      access_token: notifToken.access_token,
      refresh_token: notifToken.refresh_token,
      expiry_date: notifToken.token_expiry ? new Date(notifToken.token_expiry).getTime() : undefined,
    });

    oauth2Client.on("tokens", async (newTokens) => {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (newTokens.access_token) updates.access_token = newTokens.access_token;
      if (newTokens.expiry_date) updates.token_expiry = new Date(newTokens.expiry_date).toISOString();
      await supabaseForTokens.from("google_oauth_tokens").update(updates).eq("id", notifToken.id);
    });

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const fromEmail = "unzegrouppk@gmail.com";

    const html = buildEmailHtml({ heading, body, linkUrl, linkLabel, whatsAppPhone, whatsAppMessage });
    const raw = buildRawEmail(to, fromEmail, subject, html);

    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });

    const supabase = createServiceClient();
    await supabase.from("notification_log").insert({
      recipient_email: to,
      recipient_name: recipientName || null,
      channel: "email",
      subject,
      body_preview: heading,
      trigger_type: triggerType,
      trigger_record_id: triggerRecordId || null,
      status: "sent",
    });

    return { success: true };
  } catch (err) {
    console.error("Email send failed:", err instanceof Error ? err.message : err);
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
