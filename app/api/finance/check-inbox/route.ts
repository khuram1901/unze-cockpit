import { NextRequest } from "next/server";
import { google } from "googleapis";
import { parseCashFlowPDF } from "../../../lib/pdf-parsers/cash-flow-parser";
import { parseBankPositionPDF } from "../../../lib/pdf-parsers/bank-position-parser";
import { reconcile, matchBankPositionToCashFlow } from "../../../lib/pdf-parsers/reconcile";

import { createServiceClient } from "../../../lib/supabase-server";
import { UTPL_COMPANY_ID, IFPL_COMPANY_ID } from "../../../lib/constants";
import { safeDecrypt, encrypt } from "../../../lib/crypto";
import { archiveSourceDocument } from "../../../lib/document-archive";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const TARGET_EMAILS = ["k.saleem@unzegroup.com"];

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

    const tokenReadAt = tokenRow.updated_at;
    oauth2Client.on("tokens", async (newTokens) => {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (newTokens.access_token) updates.access_token = encrypt(newTokens.access_token);
      if (newTokens.expiry_date) updates.token_expiry = new Date(newTokens.expiry_date).toISOString();
      // Optimistic lock: only update if another cron hasn't refreshed since we read
      let query = supabase.from("google_oauth_tokens").update(updates).eq("id", tokenRow.id);
      if (tokenReadAt) query = query.eq("updated_at", tokenReadAt);
      await query;
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

      // Group PDFs by date and company prefix extracted from filename
      // Filenames like: "Unze Cash Flow 23-06-2026.pdf", "Cash Flow 19-06-2026.pdf", "Bank Position 19-06-2026.pdf"
      function extractDateFromFilename(fn: string): string | null {
        const m = fn.match(/(\d{2})-(\d{2})-(\d{4})/);
        if (m) return `${m[3]}-${m[2]}-${m[1]}`;
        const m2 = fn.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
        return null;
      }

      function isCashFlowFile(fn: string) {
        const lower = fn.toLowerCase();
        return lower.includes("cash flow") || lower.includes("cash_flow") || lower.includes("cashflow");
      }

      function isBankPositionFile(fn: string) {
        const lower = fn.toLowerCase();
        return lower.includes("bank position") || lower.includes("bank_position") || lower.includes("bankposition");
      }

      function isUnzeFile(fn: string) {
        return fn.toLowerCase().includes("unze");
      }

      // Build pairs grouped by (date, company_prefix)
      type PdfAtt = { filename: string; data: Buffer };
      const groups = new Map<string, { cashFlow?: PdfAtt; bankPosition?: PdfAtt; standalone: PdfAtt[] }>();

      for (const pdf of pdfAttachments) {
        // Skip range files like "10 to 17-06-2026" — too ambiguous
        if (pdf.filename.match(/\d+\s+to\s+\d+/i)) continue;

        const dateStr = extractDateFromFilename(pdf.filename);
        if (!dateStr) continue;

        const prefix = isUnzeFile(pdf.filename) ? "unze" : "imperial";
        const key = `${dateStr}|${prefix}`;
        if (!groups.has(key)) groups.set(key, { standalone: [] });
        const g = groups.get(key)!;

        if (isCashFlowFile(pdf.filename)) {
          if (!g.cashFlow) g.cashFlow = pdf;
        } else if (isBankPositionFile(pdf.filename)) {
          if (!g.bankPosition) g.bankPosition = pdf;
        } else {
          g.standalone.push(pdf);
        }
      }

      // Process each group
      for (const [key, group] of groups) {
        const [groupDate] = key.split("|");

        // Cash flow + bank position pair
        if (group.cashFlow && group.bankPosition) {
          try {
            const cashFlowResults = await parseCashFlowPDF(group.cashFlow.data);
            const bankPositionResults = await parseBankPositionPDF(group.bankPosition.data);

            const pairCompanyId = cashFlowResults[0]?.company === "imperial" ? IFPL_COMPANY_ID : UTPL_COMPANY_ID;
            await Promise.all([
              archiveSourceDocument({
                supabase, buffer: group.cashFlow.data, filename: group.cashFlow.filename,
                docType: "cash_flow", companyId: pairCompanyId, positionDate: cashFlowResults[0]?.date || groupDate,
                source: "gmail-auto",
              }),
              archiveSourceDocument({
                supabase, buffer: group.bankPosition.data, filename: group.bankPosition.filename,
                docType: "bank_position", companyId: pairCompanyId, positionDate: bankPositionResults[0]?.date || groupDate,
                source: "gmail-auto",
              }),
            ]);

            for (const cashFlow of cashFlowResults) {
              const positionDate = cashFlow.date || groupDate;
              const bankPosition = matchBankPositionToCashFlow(cashFlow, bankPositionResults) || (cashFlowResults.length === 1 ? bankPositionResults[0] : undefined);

              if (!bankPosition) {
                results.push({ messageId: msg.id, status: `error — no matching bank position day found for cash flow date ${positionDate} (bank position has: ${bankPositionResults.map((b) => b.date).join(", ")}) — not saved (${key})`, account: targetEmail });
                continue;
              }

              const result = reconcile(cashFlow, bankPosition);
              const ds = cashFlow.company === "imperial" ? existingDatesIfpl : existingDatesUtpl;

              if (ds.has(positionDate)) {
                results.push({ messageId: msg.id, status: "skipped — already exists", date: positionDate, account: targetEmail });
              } else {
                await saveToDatabase(positionDate, cashFlow, bankPosition, result, group.cashFlow.filename, group.bankPosition.filename);
                ds.add(positionDate);
                results.push({ messageId: msg.id, status: result.matches ? "saved — balanced" : "saved — NOT balanced", date: positionDate, account: targetEmail });
              }
            }
          } catch (parseErr) {
            results.push({ messageId: msg.id, status: `error — ${parseErr instanceof Error ? parseErr.message : "parse failed"} (${key})`, account: targetEmail });
          }
          continue;
        }

        // Cash flow only
        if (group.cashFlow) {
          try {
            const cashFlowResults = await parseCashFlowPDF(group.cashFlow.data);

            await archiveSourceDocument({
              supabase, buffer: group.cashFlow.data, filename: group.cashFlow.filename,
              docType: "cash_flow",
              companyId: cashFlowResults[0]?.company === "imperial" ? IFPL_COMPANY_ID : UTPL_COMPANY_ID,
              positionDate: cashFlowResults[0]?.date || groupDate,
              source: "gmail-auto",
            });

            for (const cashFlow of cashFlowResults) {
              const positionDate = cashFlow.date || groupDate;
              const companyId = cashFlow.company === "imperial" ? IFPL_COMPANY_ID : UTPL_COMPANY_ID;
              const dateSet = cashFlow.company === "imperial" ? existingDatesIfpl : existingDatesUtpl;

              if (dateSet.has(positionDate)) {
                results.push({ messageId: msg.id, status: "skipped — already exists", date: positionDate, account: targetEmail });
              } else {
                await supabase.from("daily_cash_position").upsert({
                  company_id: companyId,
                  position_date: positionDate,
                  opening_balance: cashFlow.openingBalanceTotal,
                  total_receipts: cashFlow.receiptsTotal,
                  total_payments: cashFlow.paymentsTotal,
                  closing_balance: cashFlow.closingBalanceUnzeTrading,
                  post_dated_total: cashFlow.loanPostDatedCHQs,
                  closing_after_post_dated: cashFlow.closingAfterLoanPostDated,
                  raw_pdf_filename: group.cashFlow.filename,
                  uploaded_by: "gmail-auto",
                }, { onConflict: "company_id,position_date" });
                dateSet.add(positionDate);
                results.push({ messageId: msg.id, status: `saved — ${cashFlow.company} (cash flow only)`, date: positionDate, account: targetEmail });
              }
            }
          } catch (parseErr) {
            results.push({ messageId: msg.id, status: `error — ${parseErr instanceof Error ? parseErr.message : "parse failed"} (${key})`, account: targetEmail });
          }
        }
      }

      // Fallback for emails with 1-2 unrecognised PDFs that didn't match any group
      if (groups.size === 0 && pdfAttachments.length <= 2) {
        if (pdfAttachments.length === 1) {
          try {
            const cashFlowResults = await parseCashFlowPDF(pdfAttachments[0].data);

            await archiveSourceDocument({
              supabase, buffer: pdfAttachments[0].data, filename: pdfAttachments[0].filename,
              docType: "cash_flow",
              companyId: cashFlowResults[0]?.company === "imperial" ? IFPL_COMPANY_ID : UTPL_COMPANY_ID,
              positionDate: cashFlowResults[0]?.date || null,
              source: "gmail-auto",
            });

            for (const cashFlow of cashFlowResults) {
              const positionDate = cashFlow.date;
              if (!positionDate) continue;
              const companyId = cashFlow.company === "imperial" ? IFPL_COMPANY_ID : UTPL_COMPANY_ID;
              const dateSet = cashFlow.company === "imperial" ? existingDatesIfpl : existingDatesUtpl;
              if (!dateSet.has(positionDate)) {
                await supabase.from("daily_cash_position").upsert({
                  company_id: companyId, position_date: positionDate,
                  opening_balance: cashFlow.openingBalanceTotal, total_receipts: cashFlow.receiptsTotal,
                  total_payments: cashFlow.paymentsTotal, closing_balance: cashFlow.closingBalanceUnzeTrading,
                  post_dated_total: cashFlow.loanPostDatedCHQs, closing_after_post_dated: cashFlow.closingAfterLoanPostDated,
                  raw_pdf_filename: pdfAttachments[0].filename, uploaded_by: "gmail-auto",
                }, { onConflict: "company_id,position_date" });
                dateSet.add(positionDate);
                results.push({ messageId: msg.id, status: `saved — ${cashFlow.company} (single PDF)`, date: positionDate, account: targetEmail });
              } else {
                results.push({ messageId: msg.id, status: "skipped — already exists", date: positionDate, account: targetEmail });
              }
            }
          } catch (e) {
            results.push({ messageId: msg.id, status: `error — ${e instanceof Error ? e.message : "parse failed"}`, account: targetEmail });
          }
        } else {
          try {
            const cashFlowResults = await parseCashFlowPDF(pdfAttachments[0].data);
            const bankPositionResults = await parseBankPositionPDF(pdfAttachments[1].data);

            const fallbackCompanyId = cashFlowResults[0]?.company === "imperial" ? IFPL_COMPANY_ID : UTPL_COMPANY_ID;
            await Promise.all([
              archiveSourceDocument({
                supabase, buffer: pdfAttachments[0].data, filename: pdfAttachments[0].filename,
                docType: "cash_flow", companyId: fallbackCompanyId, positionDate: cashFlowResults[0]?.date || null,
                source: "gmail-auto",
              }),
              archiveSourceDocument({
                supabase, buffer: pdfAttachments[1].data, filename: pdfAttachments[1].filename,
                docType: "bank_position", companyId: fallbackCompanyId, positionDate: bankPositionResults[0]?.date || null,
                source: "gmail-auto",
              }),
            ]);

            for (const cashFlow of cashFlowResults) {
              const bankPosition = matchBankPositionToCashFlow(cashFlow, bankPositionResults) || (cashFlowResults.length === 1 ? bankPositionResults[0] : undefined);
              const positionDate = cashFlow.date || bankPosition?.date;

              if (!bankPosition) {
                results.push({ messageId: msg.id, status: `error — no matching bank position day found for cash flow date ${positionDate || "unknown"} (bank position has: ${bankPositionResults.map((b) => b.date).join(", ")}) — not saved`, account: targetEmail });
                continue;
              }

              const result = reconcile(cashFlow, bankPosition);
              if (positionDate) {
                const ds = cashFlow.company === "imperial" ? existingDatesIfpl : existingDatesUtpl;
                if (!ds.has(positionDate)) {
                  await saveToDatabase(positionDate, cashFlow, bankPosition, result, pdfAttachments[0].filename, pdfAttachments[1].filename);
                  ds.add(positionDate);
                  results.push({ messageId: msg.id, status: result.matches ? "saved — balanced" : "saved — NOT balanced", date: positionDate, account: targetEmail });
                } else {
                  results.push({ messageId: msg.id, status: "skipped — already exists", date: positionDate, account: targetEmail });
                }
              }
            }
          } catch (parseErr) {
            results.push({ messageId: msg.id, status: `error — ${parseErr instanceof Error ? parseErr.message : "parse failed"}`, account: targetEmail });
          }
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
  cashFlow: Awaited<ReturnType<typeof parseCashFlowPDF>>[number],
  bankPosition: Awaited<ReturnType<typeof parseBankPositionPDF>>[number],
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
