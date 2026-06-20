import { NextRequest } from "next/server";
import { google } from "googleapis";
import { parseCashFlowPDF } from "../../../lib/pdf-parsers/cash-flow-parser";
import { parseBankPositionPDF } from "../../../lib/pdf-parsers/bank-position-parser";
import { reconcile } from "../../../lib/pdf-parsers/reconcile";
import { createServiceClient } from "../../../lib/supabase-server";
import { UTPL_COMPANY_ID } from "../../../lib/constants";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    // Use the notification Gmail account (unzegrouppk@gmail.com) for inbox checking
    const supabase = createServiceClient();
    const { data: notifToken } = await supabase
      .from("google_oauth_tokens")
      .select("*")
      .eq("user_email", "unzegrouppk@gmail.com")
      .single();

    if (!notifToken) {
      return Response.json({ error: "Notification Gmail not connected" }, { status: 500 });
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

    // Find unread emails with the cockpit-cash label
    const labelsRes = await gmail.users.labels.list({ userId: "me" });
    const cockpitLabel = labelsRes.data.labels?.find(
      (l) => l.name?.toLowerCase() === "cockpit-cash"
    );

    if (!cockpitLabel?.id) {
      return Response.json({
        ok: true,
        message: "No 'cockpit-cash' label found. Create a Gmail label called 'cockpit-cash' and set up a filter.",
        processed: 0,
      });
    }

    const messagesRes = await gmail.users.messages.list({
      userId: "me",
      labelIds: [cockpitLabel.id],
      q: "is:unread",
      maxResults: 5,
    });

    const messageIds = messagesRes.data.messages || [];
    if (messageIds.length === 0) {
      return Response.json({ ok: true, message: "No new emails", processed: 0 });
    }

    const results: { messageId: string; status: string; date?: string }[] = [];

    for (const msg of messageIds) {
      if (!msg.id) continue;

      const fullMsg = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
      });

      // Recursively find all PDF attachments (Gmail nests parts)
      type GmailPart = { filename?: string | null; mimeType?: string | null; body?: { attachmentId?: string | null; data?: string | null } | null; parts?: GmailPart[] | null };
      function findPdfParts(parts: GmailPart[]): GmailPart[] {
        const found: GmailPart[] = [];
        for (const part of parts) {
          if (part.filename && part.filename.toLowerCase().endsWith(".pdf") && part.body?.attachmentId) {
            found.push(part);
          }
          if (part.parts) {
            found.push(...findPdfParts(part.parts));
          }
        }
        return found;
      }

      const allParts = fullMsg.data.payload?.parts || [];
      const pdfParts = findPdfParts(allParts);
      const pdfAttachments: { filename: string; data: Buffer }[] = [];

      for (const part of pdfParts) {
        const attachment = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId: msg.id!,
          id: part.body!.attachmentId!,
        });

        if (attachment.data.data) {
          pdfAttachments.push({
            filename: part.filename!,
            data: Buffer.from(attachment.data.data, "base64"),
          });
        }
      }

      if (pdfAttachments.length < 2) {
        results.push({ messageId: msg.id, status: "skipped — need 2 PDF attachments" });
        // Mark as read anyway so we don't re-process
        await gmail.users.messages.modify({
          userId: "me",
          id: msg.id,
          requestBody: { removeLabelIds: ["UNREAD"] },
        });
        continue;
      }

      // Identify which is cash flow and which is bank position
      const cashFlowPdf = pdfAttachments.find((a) =>
        a.filename.toLowerCase().includes("cash_flow") || a.filename.toLowerCase().includes("cashflow")
      );
      const bankPositionPdf = pdfAttachments.find((a) =>
        a.filename.toLowerCase().includes("bank_position") || a.filename.toLowerCase().includes("bankposition")
      );

      if (!cashFlowPdf || !bankPositionPdf) {
        // Try by order: first = cash flow, second = bank position
        const pdf1 = pdfAttachments[0];
        const pdf2 = pdfAttachments[1];

        try {
          const cashFlow = await parseCashFlowPDF(pdf1.data);
          const bankPosition = await parseBankPositionPDF(pdf2.data);
          const result = reconcile(cashFlow, bankPosition);
          const positionDate = cashFlow.date || bankPosition.date;

          if (positionDate) {
            await saveToDatabase(positionDate, cashFlow, bankPosition, result, pdf1.filename, pdf2.filename);
            results.push({ messageId: msg.id, status: result.matches ? "saved — balanced" : "saved — NOT balanced", date: positionDate });
          } else {
            results.push({ messageId: msg.id, status: "error — no date found in PDFs" });
          }
        } catch (parseErr) {
          results.push({ messageId: msg.id, status: `error — ${parseErr instanceof Error ? parseErr.message : "parse failed"}` });
        }
      } else {
        try {
          const cashFlow = await parseCashFlowPDF(cashFlowPdf.data);
          const bankPosition = await parseBankPositionPDF(bankPositionPdf.data);
          const result = reconcile(cashFlow, bankPosition);
          const positionDate = cashFlow.date || bankPosition.date;

          if (positionDate) {
            await saveToDatabase(positionDate, cashFlow, bankPosition, result, cashFlowPdf.filename, bankPositionPdf.filename);
            results.push({ messageId: msg.id, status: result.matches ? "saved — balanced" : "saved — NOT balanced", date: positionDate });
          } else {
            results.push({ messageId: msg.id, status: "error — no date found in PDFs" });
          }
        } catch (parseErr) {
          results.push({ messageId: msg.id, status: `error — ${parseErr instanceof Error ? parseErr.message : "parse failed"}` });
        }
      }

      // Mark email as read
      await gmail.users.messages.modify({
        userId: "me",
        id: msg.id,
        requestBody: { removeLabelIds: ["UNREAD"] },
      });
    }

    return Response.json({ ok: true, processed: results.length, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Gmail check-inbox error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

async function saveToDatabase(
  positionDate: string,
  cashFlow: Awaited<ReturnType<typeof parseCashFlowPDF>>,
  bankPosition: Awaited<ReturnType<typeof parseBankPositionPDF>>,
  result: ReturnType<typeof reconcile>,
  cashFlowFilename: string,
  bankPositionFilename: string
) {
  const supabase = createServiceClient();

  await supabase.from("daily_cash_position").upsert(
    {
      company_id: UTPL_COMPANY_ID,
      position_date: positionDate,
      opening_balance: cashFlow.openingBalanceTotal,
      total_receipts: cashFlow.receiptsTotal,
      total_payments: cashFlow.paymentsTotal,
      closing_balance: cashFlow.closingBalanceUnzeTrading,
      post_dated_total: cashFlow.loanPostDatedCHQs,
      closing_after_post_dated: cashFlow.closingAfterLoanPostDated,
      raw_pdf_filename: cashFlowFilename,
      uploaded_by: "gmail-auto",
      reconciled: result.matches,
    },
    { onConflict: "company_id,position_date" }
  );

  await supabase.from("bank_position_snapshots").upsert(
    {
      company_id: UTPL_COMPANY_ID,
      position_date: positionDate,
      ...bankPosition.banks,
      total_available_balance: bankPosition.totalAvailableBalance,
      post_dated_cheques_total: bankPosition.postDatedCHQsTotal,
      post_dated_currency: bankPosition.postDatedCurrency,
      raw_pdf_filename: bankPositionFilename,
      uploaded_by: "gmail-auto",
      reconciled: result.matches,
      reconcile_notes: result.matches
        ? "Balanced (auto-ingested)"
        : `Mismatch: cash flow closing ${result.cashFlowClosing.toLocaleString()} vs bank total ${result.bankPositionTotal.toLocaleString()} (diff: ${result.diff.toLocaleString()})`,
    },
    { onConflict: "company_id,position_date" }
  );
}
