import { NextRequest } from "next/server";
import { google } from "googleapis";
import { parseCashFlowPDF } from "../../../lib/pdf-parsers/cash-flow-parser";
import { parseBankPositionPDF } from "../../../lib/pdf-parsers/bank-position-parser";
import { reconcile } from "../../../lib/pdf-parsers/reconcile";
import { createServiceClient } from "../../../lib/supabase-server";
import { UTPL_COMPANY_ID, IFPL_COMPANY_ID } from "../../../lib/constants";
import { safeDecrypt, encrypt } from "../../../lib/crypto";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const TARGET_EMAILS = ["khuram1901@gmail.com", "k.saleem@unzegroup.com"];

    // Get existing dates for BOTH companies so we skip already-processed ones
    const { data: existingUtpl } = await supabase
      .from("daily_cash_position")
      .select("position_date")
      .eq("company_id", UTPL_COMPANY_ID);
    const { data: existingIfpl } = await supabase
      .from("daily_cash_position")
      .select("position_date")
      .eq("company_id", IFPL_COMPANY_ID);
    const existingDatesUtpl = new Set((existingUtpl || []).map((p) => p.position_date));
    const existingDatesIfpl = new Set((existingIfpl || []).map((p) => p.position_date));

    const results: { messageId: string; status: string; date?: string; account?: string }[] = [];
    const accountSummaries: { email: string; status: string; processed: number }[] = [];

    for (const targetEmail of TARGET_EMAILS) {
    const { data: tokenRow } = await supabase
      .from("google_oauth_tokens")
      .select("*")
      .eq("user_email", targetEmail)
      .single();

    if (!tokenRow) {
      accountSummaries.push({ email: targetEmail, status: "not connected", processed: 0 });
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
      accountSummaries.push({ email: targetEmail, status: `auth error: ${e instanceof Error ? e.message : "unknown"}`, processed: 0 });
      continue;
    }

    // Find emails with the cockpit-cash label
    const labelsRes = await gmail.users.labels.list({ userId: "me" });
    const allLabels = (labelsRes.data.labels || []).map((l) => l.name);
    const cockpitLabel = labelsRes.data.labels?.find(
      (l) => l.name?.toLowerCase().includes("cockpit")
    );

    if (!cockpitLabel?.id) {
      accountSummaries.push({ email: targetEmail, status: `no cockpit label found (labels: ${allLabels.filter(Boolean).slice(0, 10).join(", ")})`, processed: 0 });
      continue;
    }

    const messagesRes = await gmail.users.messages.list({
      userId: "me",
      labelIds: [cockpitLabel.id],
      q: "newer_than:30d",
      maxResults: 20,
    });

    const messageIds = messagesRes.data.messages || [];
    if (messageIds.length === 0) {
      accountSummaries.push({ email: targetEmail, status: "label found but no emails in last 30 days", processed: 0 });
      continue;
    }

    let accountProcessed = 0;

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

      if (pdfAttachments.length === 0) {
        results.push({ messageId: msg.id, status: "skipped — no PDF attachments", account: targetEmail });
        continue;
      }

      // Single PDF — just cash flow, save without bank reconciliation
      if (pdfAttachments.length === 1) {
        try {
          const cashFlow = await parseCashFlowPDF(pdfAttachments[0].data);
          const positionDate = cashFlow.date;
          if (!positionDate) {
            results.push({ messageId: msg.id, status: "error — no date found in PDF", account: targetEmail });
            continue;
          }
          if (cashFlow.openingBalanceTotal === 0 && cashFlow.receiptsTotal === 0 && cashFlow.paymentsTotal === 0 && cashFlow.closingBalanceUnzeTrading === 0) {
            results.push({ messageId: msg.id, status: "skipped — all values zero", date: positionDate, account: targetEmail });
            continue;
          }
          const companyId = cashFlow.company === "imperial" ? IFPL_COMPANY_ID : UTPL_COMPANY_ID;
          const dateSet = cashFlow.company === "imperial" ? existingDatesIfpl : existingDatesUtpl;
          if (dateSet.has(positionDate)) {
            results.push({ messageId: msg.id, status: "skipped — already exists", date: positionDate, account: targetEmail });
            continue;
          }
          await supabase.from("daily_cash_position").upsert({
            company_id: companyId,
            position_date: positionDate,
            opening_balance: cashFlow.openingBalanceTotal,
            total_receipts: cashFlow.receiptsTotal,
            total_payments: cashFlow.paymentsTotal,
            closing_balance: cashFlow.closingBalanceUnzeTrading,
            post_dated_total: cashFlow.loanPostDatedCHQs,
            closing_after_post_dated: cashFlow.closingAfterLoanPostDated,
            raw_pdf_filename: pdfAttachments[0].filename,
            uploaded_by: "gmail-auto",
          }, { onConflict: "company_id,position_date" });
          dateSet.add(positionDate);
          results.push({ messageId: msg.id, status: `saved — ${cashFlow.company} (single PDF)`, date: positionDate, account: targetEmail });
        } catch (e) {
          results.push({ messageId: msg.id, status: `error — ${e instanceof Error ? e.message : "parse failed"}`, account: targetEmail });
        }
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
            const ds = cashFlow.company === "imperial" ? existingDatesIfpl : existingDatesUtpl;
            if (ds.has(positionDate)) {
              results.push({ messageId: msg.id, status: "skipped — already exists", date: positionDate, account: targetEmail });
            } else {
              await saveToDatabase(positionDate, cashFlow, bankPosition, result, pdf1.filename, pdf2.filename);
              ds.add(positionDate);
              results.push({ messageId: msg.id, status: result.matches ? "saved — balanced" : "saved — NOT balanced", date: positionDate, account: targetEmail });
            }
          } else {
            results.push({ messageId: msg.id, status: "error — no date found in PDFs", account: targetEmail });
          }
        } catch (parseErr) {
          results.push({ messageId: msg.id, status: `error — ${parseErr instanceof Error ? parseErr.message : "parse failed"}`, account: targetEmail });
        }
      } else {
        try {
          const cashFlow = await parseCashFlowPDF(cashFlowPdf.data);
          const bankPosition = await parseBankPositionPDF(bankPositionPdf.data);
          const result = reconcile(cashFlow, bankPosition);
          const positionDate = cashFlow.date || bankPosition.date;

          if (positionDate) {
            const ds = cashFlow.company === "imperial" ? existingDatesIfpl : existingDatesUtpl;
            if (ds.has(positionDate)) {
              results.push({ messageId: msg.id, status: "skipped — already exists", date: positionDate, account: targetEmail });
            } else {
              await saveToDatabase(positionDate, cashFlow, bankPosition, result, cashFlowPdf.filename, bankPositionPdf.filename);
              ds.add(positionDate);
              results.push({ messageId: msg.id, status: result.matches ? "saved — balanced" : "saved — NOT balanced", date: positionDate, account: targetEmail });
            }
          } else {
            results.push({ messageId: msg.id, status: "error — no date found in PDFs", account: targetEmail });
          }
        } catch (parseErr) {
          results.push({ messageId: msg.id, status: `error — ${parseErr instanceof Error ? parseErr.message : "parse failed"}`, account: targetEmail });
        }
      }

      // Mark email as read
      await gmail.users.messages.modify({
        userId: "me",
        id: msg.id,
        requestBody: { removeLabelIds: ["UNREAD"] },
      });
      accountProcessed++;
    }

    accountSummaries.push({ email: targetEmail, status: "ok", processed: accountProcessed });
    } // end for-each account

    return Response.json({ ok: true, processed: results.length, results, accounts: accountSummaries });
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
  const companyId = cashFlow.company === "imperial" ? IFPL_COMPANY_ID : UTPL_COMPANY_ID;

  await supabase.from("daily_cash_position").upsert(
    {
      company_id: companyId,
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
      company_id: companyId,
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
