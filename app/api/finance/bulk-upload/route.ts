import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { parseCashFlowPDF } from "../../../lib/pdf-parsers/cash-flow-parser";
import { UTPL_COMPANY_ID, IFPL_COMPANY_ID } from "../../../lib/constants";
import { requireAuth } from "../../../lib/api-auth";
import { archiveSourceDocument } from "../../../lib/document-archive";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (files.length === 0) {
      return Response.json({ error: "No PDF files provided." }, { status: 400 });
    }

    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per file
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        return Response.json({ error: `File "${file.name}" exceeds 10 MB limit.` }, { status: 413 });
      }
    }

    const supabase = createServiceClient();
    const results: { filename: string; status: string; date?: string; company?: string }[] = [];

    for (const file of files) {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        results.push({ filename: file.name, status: "skipped — not a PDF" });
        continue;
      }

      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const parsedResults = await parseCashFlowPDF(buffer);

        const archiveCompanyId = parsedResults[0]?.company === "imperial" ? IFPL_COMPANY_ID : UTPL_COMPANY_ID;
        await archiveSourceDocument({
          supabase,
          buffer,
          filename: file.name,
          docType: "cash_flow",
          companyId: archiveCompanyId,
          positionDate: parsedResults[0]?.date || null,
          source: "manual",
          uploadedBy: "bulk-upload",
        });

        for (const parsed of parsedResults) {
          const label = parsedResults.length > 1 ? `${file.name} (${parsed.date})` : file.name;

          if (!parsed.date) {
            results.push({ filename: label, status: "error — no date found" });
            continue;
          }

          const companyId = parsed.company === "imperial" ? IFPL_COMPANY_ID : UTPL_COMPANY_ID;

          const { error } = await supabase.from("daily_cash_position").upsert(
            {
              company_id: companyId,
              position_date: parsed.date,
              opening_balance: parsed.openingBalanceTotal,
              total_receipts: parsed.receiptsTotal,
              total_payments: parsed.paymentsTotal,
              closing_balance: parsed.closingBalanceUnzeTrading,
              post_dated_total: parsed.loanPostDatedCHQs,
              closing_after_post_dated: parsed.closingAfterLoanPostDated,
              raw_pdf_filename: file.name,
              uploaded_by: "bulk-upload",
            },
            { onConflict: "company_id,position_date" }
          );

          if (error) {
            results.push({ filename: label, status: "error — " + error.message, date: parsed.date, company: parsed.company });
          } else {
            results.push({ filename: label, status: "saved", date: parsed.date, company: parsed.company });
          }
        }
      } catch (e) {
        results.push({ filename: file.name, status: "error — " + (e instanceof Error ? e.message : "parse failed") });
      }
    }

    const saved = results.filter((r) => r.status === "saved").length;
    const errors = results.filter((r) => r.status.startsWith("error")).length;

    return Response.json({ ok: true, total: files.length, saved, errors, results });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
