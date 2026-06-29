import { NextRequest } from "next/server";
import { google } from "googleapis";
import { createServiceClient } from "../../../lib/supabase-server";
import { safeDecrypt, encrypt } from "../../../lib/crypto";
import pdfParse from "pdf-parse";
import * as mammoth from "mammoth";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }
  return handleCheckInbox(true);
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const { createClient } = await import("@supabase/supabase-js");
  const userClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user?.email) return Response.json({ error: "Unauthorised" }, { status: 401 });
  return handleCheckInbox(false);
}

async function handleCheckInbox(isCron: boolean) {
  try {
    const supabase = createServiceClient();
    const TARGET_EMAILS = ["khuram1901@gmail.com", "k.saleem@unzegroup.com"];

    const emails: { id: string; subject: string; from: string; date: string; text: string; account?: string }[] = [];
    let newPendingCount = 0;
    const accountSummaries: { email: string; status: string; found: number }[] = [];

    type GmailPart = { filename?: string | null; mimeType?: string | null; body?: { attachmentId?: string | null; data?: string | null } | null; parts?: GmailPart[] | null };

    for (const targetEmail of TARGET_EMAILS) {
      const { data: tokenRow } = await supabase
        .from("google_oauth_tokens")
        .select("*")
        .eq("user_email", targetEmail)
        .single();

      if (!tokenRow) {
        accountSummaries.push({ email: targetEmail, status: "not connected", found: 0 });
        continue;
      }

      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        (process.env.GOOGLE_REDIRECT_URI || "").replace("/callback", "/callback-notifications")
      );
      oauth2Client.setCredentials({
        access_token: safeDecrypt(tokenRow.access_token),
        refresh_token: safeDecrypt(tokenRow.refresh_token),
        expiry_date: tokenRow.token_expiry ? new Date(tokenRow.token_expiry).getTime() : undefined,
      });

      oauth2Client.on("tokens", async (newTokens) => {
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (newTokens.access_token) updates.access_token = encrypt(newTokens.access_token);
        if (newTokens.expiry_date) updates.token_expiry = new Date(newTokens.expiry_date).toISOString();
        await supabase.from("google_oauth_tokens").update(updates).eq("id", tokenRow.id);
      });

      let gmail;
      try {
        gmail = google.gmail({ version: "v1", auth: oauth2Client });
      } catch (e) {
        accountSummaries.push({ email: targetEmail, status: `auth error: ${e instanceof Error ? e.message : "unknown"}`, found: 0 });
        continue;
      }

      const labelsRes = await gmail.users.labels.list({ userId: "me" });
      const minutesLabel = labelsRes.data.labels?.find(
        (l) => l.name?.toLowerCase() === "minutes-of-meeting"
      );

      if (!minutesLabel?.id) {
        accountSummaries.push({ email: targetEmail, status: "no 'minutes-of-meeting' label found", found: 0 });
        continue;
      }

      const messagesRes = await gmail.users.messages.list({
        userId: "me",
        labelIds: [minutesLabel.id],
        q: "newer_than:30d",
        maxResults: 20,
      });

      const messageIds = messagesRes.data.messages || [];
      if (messageIds.length === 0) {
        accountSummaries.push({ email: targetEmail, status: "label found but no emails in last 30 days", found: 0 });
        continue;
      }

      let accountFound = 0;

      for (const msg of messageIds) {
        if (!msg.id) continue;

        const fullMsg = await gmail.users.messages.get({ userId: "me", id: msg.id });
        const headers = fullMsg.data.payload?.headers || [];
        const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value || "No subject";
        const from = headers.find((h) => h.name?.toLowerCase() === "from")?.value || "Unknown";
        const date = headers.find((h) => h.name?.toLowerCase() === "date")?.value || "";

        let bodyText = "";

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

          if (!bodyText && fullMsg.data.payload?.body?.data) {
            bodyText = Buffer.from(fullMsg.data.payload.body.data, "base64url").toString("utf-8");
          }
        }

        if (bodyText.trim()) {
          emails.push({ id: msg.id, subject, from, date, text: bodyText.trim(), account: targetEmail });
          accountFound++;

          const { data: existing } = await supabase
            .from("pending_minutes")
            .select("id")
            .eq("gmail_message_id", msg.id)
            .maybeSingle();

          if (!existing) {
            const { error: insertErr } = await supabase
              .from("pending_minutes")
              .insert({
                gmail_message_id: msg.id,
                subject,
                from_address: from,
                email_date: date,
                raw_text: bodyText.trim(),
                status: "pending",
              });

            if (!insertErr) newPendingCount++;
          }
        }

        await gmail.users.messages.modify({
          userId: "me",
          id: msg.id,
          requestBody: { removeLabelIds: ["UNREAD"] },
        });
      }

      accountSummaries.push({ email: targetEmail, status: "ok", found: accountFound });
    }

    // Send notifications for new pending minutes (cron only)
    if (isCron && newPendingCount > 0) {
      const { data: admins } = await supabase
        .from("members")
        .select("email, role")
        .in("role", ["Admin", "Executive"]);

      const notifyEmails = new Set((admins || []).map((a) => a.email));
      notifyEmails.add("pa.ceo@unze.co.uk");

      for (const recipientEmail of notifyEmails) {
        await supabase.from("notifications").insert({
          user_email: recipientEmail,
          type: "pending_minutes",
          title: `${newPendingCount} new meeting minutes awaiting review`,
          body: `${newPendingCount} new minutes email${newPendingCount > 1 ? "s have" : " has"} been received. Review and approve on the Meetings page.`,
          link: "/meetings",
        });
      }
    }

    return Response.json({
      success: true,
      emails,
      newPending: newPendingCount,
      accounts: accountSummaries,
      message: emails.length > 0
        ? `Found ${emails.length} minutes email${emails.length !== 1 ? "s" : ""}${newPendingCount > 0 ? ` (${newPendingCount} new)` : ""}.`
        : "No new minutes emails found.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Minutes inbox check error:", message);
    return Response.json({ error: "Failed to check inbox: " + message }, { status: 500 });
  }
}
