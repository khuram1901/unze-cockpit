import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { parseCashFlowPDF } from "../../../lib/pdf-parsers/cash-flow-parser";
import {
import { isAdmin } from "../../../lib/admin-config";
  UTPL_COMPANY_ID, IFPL_COMPANY_ID, BRNH_COMPANY_ID, HD_COMPANY_ID, KKJ_COMPANY_ID,
} from "../../../lib/constants";

// ── POST /api/admin/backfill-cash-sheets ─────────────────────────────────────
// One-off backfill: for every daily_cash_position day whose cash sheet has no
// stored transaction line items, re-parse the archived cash-flow PDF (indexed
// in document_archive) with the current parser and fill in:
//   • cash_sheet_uploads row (created/updated + linked)
//   • cash_sheet_transactions line items
//   • daily_cash_position PDC fields (only where currently zero)
//   • pdc_maturity_buckets (only where the day has none)
// Batched — call repeatedly until { remaining: 0 }. Admin-only.
//
// Body: { limit?: number, dryRun?: boolean }


const ID_TO_CODE: Record<string, "UTPL" | "IFPL" | "BRNH" | "HD" | "KKJ"> = {
  [UTPL_COMPANY_ID]: "UTPL",
  [IFPL_COMPANY_ID]: "IFPL",
  [BRNH_COMPANY_ID]: "BRNH",
  [HD_COMPANY_ID]: "HD",
  [KKJ_COMPANY_ID]: "KKJ",
};

type WorkItem = {
  companyId: string;
  code: "UTPL" | "IFPL" | "BRNH" | "HD" | "KKJ";
  date: string;
  dcpId: string;
  pdcTotalCurrent: number;
};

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  if (!isAdmin(auth.email.toLowerCase())) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  let body: { limit?: number; dryRun?: boolean } = {};
  try { body = await request.json(); } catch { /* defaults */ }
  const limit = Math.min(Math.max(body.limit ?? 8, 1), 25);
  const dryRun = body.dryRun === true;

  const supabase = createServiceClient();

  // 1. All position days for the five cash-sheet companies
  const { data: dcpRows, error: dcpErr } = await supabase
    .from("daily_cash_position")
    .select("id, company_id, position_date, post_dated_total")
    .order("position_date", { ascending: false });
  if (dcpErr) return Response.json({ error: dcpErr.message }, { status: 500 });

  // 2. Sheets that already have transactions
  const { data: sheetRows } = await supabase
    .from("cash_sheet_uploads")
    .select("id, company, sheet_date, cash_sheet_transactions(id)");
  const sheetsWithTxns = new Set(
    (sheetRows || [])
      .filter((s) => (s.cash_sheet_transactions || []).length > 0)
      .map((s) => `${s.company}|${s.sheet_date}`)
  );

  // 3. Work list: days missing line items
  const work: WorkItem[] = [];
  for (const d of dcpRows || []) {
    const code = ID_TO_CODE[d.company_id];
    if (!code) continue;
    if (sheetsWithTxns.has(`${code}|${d.position_date}`)) continue;
    work.push({
      companyId: d.company_id,
      code,
      date: d.position_date,
      dcpId: d.id,
      pdcTotalCurrent: Number(d.post_dated_total) || 0,
    });
  }

  const batch = work.slice(0, limit);
  const results: Record<string, unknown>[] = [];

  for (const item of batch) {
    const label = `${item.code} ${item.date}`;
    try {
      // 4a. Find the archived cash-flow PDF (latest for that company+day)
      const { data: docs } = await supabase
        .from("document_archive")
        .select("storage_path, created_at")
        .eq("doc_type", "cash_flow")
        .eq("company_id", item.companyId)
        .eq("position_date", item.date)
        .order("created_at", { ascending: false })
        .limit(1);

      let storagePath = docs?.[0]?.storage_path as string | undefined;
      let bucket = "source-documents";

      // Fallback: the manual Banking upload bucket
      if (!storagePath) {
        const year = item.date.slice(0, 4);
        const candidate = `${item.code}/${year}/${item.date}.pdf`;
        const { data: probe } = await supabase.storage.from("cash-sheets").download(candidate);
        if (probe) { storagePath = candidate; bucket = "cash-sheets"; }
      }

      if (!storagePath) {
        results.push({ label, status: "no-pdf-found" });
        continue;
      }

      // 4b. Download + parse
      const { data: file, error: dlErr } = await supabase.storage.from(bucket).download(storagePath);
      if (dlErr || !file) {
        results.push({ label, status: "download-failed", error: dlErr?.message });
        continue;
      }
      const parsedAll = await parseCashFlowPDF(Buffer.from(await file.arrayBuffer()));
      // Imperial PDFs can be multi-day — pick the block for this date
      const parsed = parsedAll.find((r) => r.date === item.date) ?? parsedAll[0];
      if (!parsed) {
        results.push({ label, status: "parse-empty" });
        continue;
      }

      if (dryRun) {
        results.push({ label, status: "dry-run", txns: parsed.transactions.length, pdc: parsed.loanPostDatedCHQs });
        continue;
      }

      // 4c. Upsert sheet
      const { data: sheet, error: sheetErr } = await supabase
        .from("cash_sheet_uploads")
        .upsert(
          {
            company: item.code,
            sheet_date: item.date,
            opening_balance_pkr: parsed.openingBalanceTotal || null,
            closing_balance_pkr: parsed.closingBalanceUnzeTrading || null,
            receipts_pkr: parsed.receiptsTotal || null,
            payments_pkr: parsed.paymentsTotal || null,
            pdf_storage_path: bucket === "cash-sheets" ? storagePath : null,
            uploaded_by: auth.email,
            source: "manual_upload",
          },
          { onConflict: "company,sheet_date" }
        )
        .select("id")
        .single();
      if (sheetErr || !sheet) {
        results.push({ label, status: "sheet-upsert-failed", error: sheetErr?.message });
        continue;
      }

      // 4d. Replace transactions
      await supabase.from("cash_sheet_transactions").delete().eq("sheet_id", sheet.id);
      if (parsed.transactions.length > 0) {
        const { error: txnErr } = await supabase.from("cash_sheet_transactions").insert(
          parsed.transactions.map((t, i) => ({
            sheet_id: sheet.id,
            company: item.code,
            sheet_date: item.date,
            txn_type: t.txn_type,
            description: t.description,
            amount_pkr: t.amount,
            sort_order: i,
          }))
        );
        if (txnErr) {
          results.push({ label, status: "txn-insert-failed", error: txnErr.message });
          continue;
        }
      }

      // 4e. Link DCP + fill PDC fields only where currently empty
      const dcpUpdate: Record<string, unknown> = { cash_sheet_id: sheet.id };
      if (item.pdcTotalCurrent === 0 && parsed.loanPostDatedCHQs) {
        dcpUpdate.post_dated_total = parsed.loanPostDatedCHQs;
        dcpUpdate.closing_after_post_dated = parsed.closingAfterLoanPostDated;
      }
      await supabase.from("daily_cash_position").update(dcpUpdate).eq("id", item.dcpId);

      // 4f. PDC buckets only if the day has none
      if (parsed.pdcBuckets.length > 0) {
        const { count } = await supabase
          .from("pdc_maturity_buckets")
          .select("id", { count: "exact", head: true })
          .eq("company_id", item.companyId)
          .eq("position_date", item.date);
        if (!count) {
          await supabase.from("pdc_maturity_buckets").insert(
            parsed.pdcBuckets
              .filter((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.dueDate))
              .map((b) => ({
                company_id: item.companyId,
                position_date: item.date,
                due_date: b.dueDate,
                amount: b.amount,
                label: b.label,
              }))
          );
        }
      }

      results.push({ label, status: "ok", txns: parsed.transactions.length, pdc: parsed.loanPostDatedCHQs || 0 });
    } catch (err) {
      results.push({ label, status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  }

  return Response.json({
    ok: true,
    processed: batch.length,
    remaining: work.length - batch.length,
    results,
  });
}
