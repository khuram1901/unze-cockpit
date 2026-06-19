import { NextRequest } from "next/server";
import { google } from "googleapis";
import { createServiceClient } from "../../../lib/supabase-server";
import pdfParse from "pdf-parse";
import * as mammoth from "mammoth";

export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const { data: notifToken } = await supabase
      .from("google_oauth_tokens")
      .select("*")
      .eq("user_email", "unzegrouppk@gmail.com")
      .single();

    if (!notifToken) {
      return Response.json({ error: "Notification Gmail not connected. Connect unzegrouppk@gmail.com first." }, { status: 500 });
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
      await supabase.from("google_oauth_tokens").update(updates).eq("id", notifToken.id);
    });

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const labelsRes = await gmail.users.labels.list({ userId: "me" });
    const minutesLabel = labelsRes.data.labels?.find(
      (l) => l.name?.toLowerCase() === "minutes-of-meeting"
    );

    if (!minutesLabel?.id) {
      return Response.json({
        success: true,
        emails: [],
        message: "No 'minutes-of-meeting' label found. Create a Gmail label called 'minutes-of-meeting' and set up a filter to auto-label forwarded minutes.",
      });
    }

    const messagesRes = await gmail.users.messages.list({
      userId: "me",
      labelIds: [minutesLabel.id],
      q: "is:unread",
      maxResults: 5,
    });

    const messageIds = messagesRes.data.messages || [];
    if (messageIds.length === 0) {
      return Response.json({ success: true, emails: [], message: "No new minutes emails." });
    }

    const emails: { id: string; subject: string; from: string; date: string; text: string }[] = [];

    for (const msg of messageIds) {
      if (!msg.id) continue;

      const fullMsg = await gmail.users.messages.get({ userId: "me", id: msg.id });
      const headers = fullMsg.data.payload?.headers || [];
      const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value || "No subject";
      const from = headers.find((h) => h.name?.toLowerCase() === "from")?.value || "Unknown";
      const date = headers.find((h) => h.name?.toLowerCase() === "date")?.value || "";

      let bodyText = "";

      type GmailPart = { filename?: string | null; mimeType?: string | null; body?: { attachmentId?: string | null; data?: string | null } | null; parts?: GmailPart[] | null };

      const findAttachments = (parts: GmailPart[]): GmailPart[] => {
        const found: GmailPart[] = [];
        for (const part of parts) {
          if (part.filename && part.body?.attachmentId) {
            const lower = part.filename.toLowerCase();
            if (lower.endsWith(".pdf") || lower.endsWith(".docx") || lower.endsWith(".txt")) {
              found.push(part);
            }
          }
          if (part.parts) found.push(...findAttachments(part.parts));
        }
        return found;
      };

      const allParts = fullMsg.data.payload?.parts || [];
      const attachments = findAttachments(allParts);

      for (const att of attachments) {
        const attachment = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId: msg.id!,
          id: att.body!.attachmentId!,
        });

        if (attachment.data.data) {
          const buffer = Buffer.from(attachment.data.data, "base64");
          const lower = att.filename!.toLowerCase();

          if (lower.endsWith(".pdf")) {
            const parsed = await pdfParse(buffer);
            bodyText += parsed.text + "\n";
          } else if (lower.endsWith(".docx")) {
            const result = await mammoth.extractRawText({ buffer });
            bodyText += result.value + "\n";
          } else if (lower.endsWith(".txt")) {
            bodyText += buffer.toString("utf-8") + "\n";
          }
        }
      }

      // If no attachment text, use the email body
      if (!bodyText.trim()) {
        const extractPlainText = (parts: GmailPart[]): string => {
          for (const part of parts) {
            if (part.mimeType === "text/plain" && part.body?.data) {
              return Buffer.from(part.body.data, "base64url").toString("utf-8");
            }
            if (part.parts) {
              const found = extractPlainText(part.parts);
              if (found) return found;
            }
          }
          return "";
        };

        bodyText = extractPlainText(allParts);

        // Fallback: try top-level body
        if (!bodyText && fullMsg.data.payload?.body?.data) {
          bodyText = Buffer.from(fullMsg.data.payload.body.data, "base64url").toString("utf-8");
        }
      }

      if (bodyText.trim()) {
        emails.push({ id: msg.id, subject, from, date, text: bodyText.trim() });
      }

      // Mark as read
      await gmail.users.messages.modify({
        userId: "me",
        id: msg.id,
        requestBody: { removeLabelIds: ["UNREAD"] },
      });
    }

    return Response.json({ success: true, emails });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Minutes inbox check error:", message);
    return Response.json({ error: "Failed to check inbox: " + message }, { status: 500 });
  }
}
