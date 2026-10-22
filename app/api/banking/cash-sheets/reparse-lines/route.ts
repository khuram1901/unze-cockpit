import { NextRequest } from "next/server";
import { createServiceClient } from "../../../../lib/supabase-server";
import { requireAuth, getMemberAccess } from "../../../../lib/api-auth";
import { extractTextFromPDF } from "../../../../lib/pdf-parsers/extract-text";
import { extractTransactionsWithTieOut } from "../../../../lib/pdf-parsers/cash-flow-parser";

// ── POST /api/banking/cash-sheets/reparse-lines ───────────────────────────────
// 22/10/2026 — one-off data repair, Admin only. Re-reads every stored cash
// sheet PDF and replaces its transaction LINES with the current parser's
// output, but only where the new lines tie exactly to the PDF's own section
// totals (payments and receipts). Headline figures (opening/receipts/payments/
// closing) are never touched. Sheets that still don't tie are reported, not
// changed. Batched (default 25 sheets per call) to stay inside the function
// time limit; call again with the returned `after` cursor until `done`.
//
// Body: { company?: "UTPL"|"IFPL"|"BRNH"|"HD"|"KKJ", after?: string (sheet id),
//         limit?: number, dryRun?: boolean }
// Backup of the previous lines: public.cash_sheet_transactions_backup_20261022.

const COMPANIES = ["UTPL", "IFPL", "BRNH", "HD", "KKJ"];

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const access = await getMemberAccess(auth.email);
  if (!(access.role === "Admin" || access.role === "CEO")) {
    return Response.json({ error: "Admin only" }, { status: 403 });
  }

  let body: { company?: string; after?: string; limit?: number; dryRun?: boolean } = {};
  try { body = await request.json(); } catch { /* defaults */ }
  const limit = Math.min(Math.max(body.limit ?? 25, 1), 60);
  const dryRun = !!body.dryRun;

  const supabase = createServiceClient();
  let q = supabase
    .from("cash_sheet_uploads")
    .select("id, company, sheet_date, pdf_storage_path, receipts_pkr, payments_pkr")
    .not("pdf_storage_path", "is", null)
    .order("company").order("sheet_date").order("id")
    .limit(limit + 1);
  if (body.company && COMPANIES.includes(body.company)) q = q.eq("company", body.company);
  if (body.after) {
    const { data: cur } = await supabase.from("cash_sheet_uploads").select("company, sheet_date").eq("id", body.after).single();
    if (cur) {
      // keyset: strictly after (company, sheet_date)
      q = q.or(`company.gt.${cur.company},and(company.eq.${cur.company},sheet_date.gt.${cur.sheet_date})`);
    }
  }
  const { data: sheets, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const page = (sheets ?? []).slice(0, limit);
  const hasMore = (sheets ?? []).length > limit;
  const results: { company: string; date: string; status: string; detail?: string; rows?: number }[] = [];

  for (const s of page) {
    try {
      const { data: file, error: dlErr } = await supabase.storage.from("cash-sheets").download(s.pdf_storage_path!);
      if (dlErr || !file) { results.push({ company: s.company, date: s.sheet_date, status: "pdf_missing", detail: dlErr?.message }); continue; }
      const text = await extractTextFromPDF(Buffer.from(await file.arrayBuffer()));
      const { rows, paymentsTie, receiptsTie } = extractTransactionsWithTieOut(text);

      // Sections with no rows and a zero header total count as tied.
      const payOk = paymentsTie || (Number(s.payments_pkr ?? 0) === 0 && !rows.some((r) => r.txn_type === "payment"));
      const recOk = receiptsTie || (Number(s.receipts_pkr ?? 0) === 0 && !rows.some((r) => r.txn_type === "receipt"));
      if (!(payOk && recOk)) {
        results.push({ company: s.company, date: s.sheet_date, status: "still_untied", detail: `payments ${payOk ? "ok" : "no"}, receipts ${recOk ? "ok" : "no"}`, rows: rows.length });
        continue;
      }
      if (dryRun) { results.push({ company: s.company, date: s.sheet_date, status: "would_replace", rows: rows.length }); continue; }

      const { error: delErr } = await supabase.from("cash_sheet_transactions").delete().eq("sheet_id", s.id);
      if (delErr) { results.push({ company: s.company, date: s.sheet_date, status: "error", detail: delErr.message }); continue; }
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from("cash_sheet_transactions").insert(rows.map((t, i) => ({
          sheet_id: s.id, company: s.company, sheet_date: s.sheet_date,
          txn_type: t.txn_type, description: t.description, amount_pkr: t.amount, sort_order: i,
        })));
        if (insErr) { results.push({ company: s.company, date: s.sheet_date, status: "error", detail: insErr.message }); continue; }
      }
      results.push({ company: s.company, date: s.sheet_date, status: "replaced", rows: rows.length });
    } catch (e) {
      results.push({ company: s.company, date: s.sheet_date, status: "error", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  return Response.json({
    ok: true,
    dryRun,
    processed: page.length,
    after: page.length ? page[page.length - 1].id : null,
    done: !hasMore,
    summary: results.reduce<Record<string, number>>((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {}),
    results,
  });
}
