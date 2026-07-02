import { NextRequest } from "next/server";
import { google } from "googleapis";
import { createServiceClient } from "../../../lib/supabase-server";
import { safeDecrypt, encrypt } from "../../../lib/crypto";
import { parseCashFlowPDF } from "../../../lib/pdf-parsers/cash-flow-parser";
import { parseBankPositionPDF } from "../../../lib/pdf-parsers/bank-position-parser";
import { reconcile, matchBankPositionToCashFlow } from "../../../lib/pdf-parsers/reconcile";
import { archiveSourceDocument } from "../../../lib/document-archive";
import { UTPL_COMPANY_ID, IFPL_COMPANY_ID } from "../../../lib/constants";

const TARGET_EMAIL = "k.saleem@unzegroup.com";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Get Drive folder IDs from settings
  const { data: settings } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", ["drive_inbox_folder_id", "drive_processed_folder_id"]);

  const inboxFolderId = settings?.find((s) => s.key === "drive_inbox_folder_id")?.value;
  const processedFolderId = settings?.find((s) => s.key === "drive_processed_folder_id")?.value;

  if (!inboxFolderId || !processedFolderId) {
    return Response.json({ error: "Drive folders not set up — run /api/finance/setup-drive-folder first" }, { status: 400 });
  }

  // Load OAuth token
  const { data: tokenRow } = await supabase
    .from("google_oauth_tokens").select("*").eq("user_email", TARGET_EMAIL).single();

  if (!tokenRow) {
    return Response.json({ error: `No token for ${TARGET_EMAIL} — reconnect Google on the Calendar page` }, { status: 400 });
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
  oauth2Client.on("tokens", async (t) => {
    const u: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (t.access_token) u.access_token = encrypt(t.access_token);
    if (t.expiry_date) u.token_expiry = new Date(t.expiry_date).toISOString();
    let q = supabase.from("google_oauth_tokens").update(u).eq("id", tokenRow.id);
    if (tokenReadAt) q = q.eq("updated_at", tokenReadAt);
    await q;
  });

  const drive = google.drive({ version: "v3", auth: oauth2Client });

  // List PDF files in the inbox folder
  const listRes = await drive.files.list({
    q: `'${inboxFolderId}' in parents and mimeType='application/pdf' and trashed=false`,
    fields: "files(id,name,size)",
    orderBy: "name",
    pageSize: 50,
  });

  const files = listRes.data.files || [];
  if (files.length === 0) {
    return Response.json({ ok: true, message: "No PDFs in inbox folder", processed: 0 });
  }

  // Fetch all PDFs as buffers
  type PdfFile = { id: string; name: string; data: Buffer };
  const pdfs: PdfFile[] = [];
  for (const file of files) {
    if (!file.id || !file.name) continue;
    const res = await drive.files.get(
      { fileId: file.id, alt: "media" },
      { responseType: "arraybuffer" }
    );
    pdfs.push({ id: file.id, name: file.name, data: Buffer.from(res.data as ArrayBuffer) });
  }

  // Group by date+company prefix extracted from filename
  // Filenames: "Unze Cash Flow 30-06-2026.pdf", "Cash Flow 30-06-2026.pdf",
  //            "Unze Bank Position 30-06-2026.pdf", "Bank Position 30-06-2026.pdf"
  function extractDateFromFilename(fn: string): string | null {
    const m = fn.match(/(\d{2})-(\d{2})-(\d{4})/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    const m2 = fn.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
    return null;
  }

  function isCashFlow(fn: string) {
    return /cash.?flow/i.test(fn);
  }

  function isBankPosition(fn: string) {
    return /bank.?position/i.test(fn);
  }

  // "Unze" in filename → unze prefix; otherwise imperial
  function filePrefix(fn: string) {
    return fn.toLowerCase().includes("unze") ? "unze" : "imperial";
  }

  type Group = { cashFlow?: PdfFile; bankPosition?: PdfFile };
  const groups = new Map<string, Group>();

  for (const pdf of pdfs) {
    const date = extractDateFromFilename(pdf.name);
    if (!date) continue;
    const prefix = filePrefix(pdf.name);
    const key = `${date}|${prefix}`;
    if (!groups.has(key)) groups.set(key, {});
    const g = groups.get(key)!;
    if (isCashFlow(pdf.name) && !g.cashFlow) g.cashFlow = pdf;
    else if (isBankPosition(pdf.name) && !g.bankPosition) g.bankPosition = pdf;
  }

  const results: { file: string; status: string; date?: string; company?: string }[] = [];
  const processedFileIds = new Set<string>();

  for (const [key, group] of groups) {
    const [groupDate] = key.split("|");

    if (!group.cashFlow) continue; // need at least a cash flow

    try {
      const cashFlowResults = await parseCashFlowPDF(group.cashFlow.data);
      const company = cashFlowResults[0]?.company || "unknown";
      const companyId = company === "imperial" ? IFPL_COMPANY_ID : UTPL_COMPANY_ID;

      await archiveSourceDocument({
        supabase, buffer: group.cashFlow.data, filename: group.cashFlow.name,
        docType: "cash_flow", companyId, positionDate: cashFlowResults[0]?.date || groupDate,
        source: "manual", uploadedBy: "drive-auto",
      });

      let bankPositionResults = null;
      if (group.bankPosition) {
        bankPositionResults = await parseBankPositionPDF(group.bankPosition.data);
        await archiveSourceDocument({
          supabase, buffer: group.bankPosition.data, filename: group.bankPosition.name,
          docType: "bank_position", companyId, positionDate: bankPositionResults[0]?.date || groupDate,
          source: "manual", uploadedBy: "drive-auto",
        });
      }

      for (const cashFlow of cashFlowResults) {
        const positionDate = cashFlow.date || groupDate;
        const bankPosition = bankPositionResults
          ? (matchBankPositionToCashFlow(cashFlow, bankPositionResults) || (cashFlowResults.length === 1 ? bankPositionResults[0] : undefined))
          : undefined;

        const rec = bankPosition ? reconcile(cashFlow, bankPosition) : null;

        const { error } = await supabase.from("daily_cash_position").upsert({
          company_id: companyId,
          position_date: positionDate,
          opening_balance: cashFlow.openingBalanceTotal,
          total_receipts: cashFlow.receiptsTotal,
          total_payments: cashFlow.paymentsTotal,
          closing_balance: cashFlow.closingBalanceUnzeTrading,
          post_dated_total: cashFlow.loanPostDatedCHQs,
          closing_after_post_dated: cashFlow.closingAfterLoanPostDated,
          raw_pdf_filename: group.cashFlow!.name,
          uploaded_by: "drive-auto",
          reconciled: rec?.matches ?? null,
        }, { onConflict: "company_id,position_date" });

        if (bankPosition) {
          await supabase.from("bank_position_snapshots").upsert({
            company_id: companyId,
            position_date: positionDate,
            ...bankPosition.banks,
            total_available_balance: bankPosition.totalAvailableBalance,
            post_dated_cheques_total: bankPosition.postDatedCHQsTotal,
            post_dated_currency: bankPosition.postDatedCurrency,
            raw_pdf_filename: group.bankPosition!.name,
            uploaded_by: "drive-auto",
            reconciled: rec?.matches ?? null,
            reconcile_notes: rec ? (rec.matches ? "Balanced" : `Mismatch: cash flow ${rec.cashFlowClosing.toLocaleString()} vs bank ${rec.bankPositionTotal.toLocaleString()} (diff: ${rec.diff.toLocaleString()})`) : "No bank position",
          }, { onConflict: "company_id,position_date" });
        }

        results.push({ file: group.cashFlow!.name, status: error ? "error — " + error.message : (rec ? (rec.matches ? "saved — balanced" : "saved — NOT balanced") : "saved — cash flow only"), date: positionDate, company });
      }

      // Mark files for moving to processed
      processedFileIds.add(group.cashFlow.id);
      if (group.bankPosition) processedFileIds.add(group.bankPosition.id);

    } catch (e) {
      results.push({ file: group.cashFlow.name, status: "error — " + (e instanceof Error ? e.message : "parse failed"), date: groupDate });
    }
  }

  // Move processed files to the processed folder
  for (const fileId of processedFileIds) {
    try {
      const fileMeta = await drive.files.get({ fileId, fields: "parents" });
      const prevParents = (fileMeta.data.parents || []).join(",");
      await drive.files.update({
        fileId,
        addParents: processedFolderId,
        removeParents: prevParents,
        fields: "id,parents",
      });
    } catch {
      // Non-fatal — file stays in inbox but was already processed
    }
  }

  return Response.json({
    ok: true,
    filesFound: pdfs.length,
    groupsProcessed: groups.size,
    results,
  });
}
