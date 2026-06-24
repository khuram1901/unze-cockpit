import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { parseCashFlowPDF } from "../../../lib/pdf-parsers/cash-flow-parser";
import { UTPL_COMPANY_ID, IFPL_COMPANY_ID } from "../../../lib/constants";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (files.length === 0) {
      return Response.json({ error: "No PDF files provided." }, { status: 400 });
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
        const parsed = await parseCashFlowPDF(buffer);

        if (!parsed.date) {
          results.push({ filename: file.name, status: "error — no date found" });
          continue;
        }

        if (parsed.openingBalanceTotal === 0 && parsed.receiptsTotal === 0 && parsed.paymentsTotal === 0 && parsed.closingBalanceUnzeTrading === 0) {
          results.push({ filename: file.name, status: "skipped — all values zero", date: parsed.date, company: parsed.company });
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
          results.push({ filename: file.name, status: "error — " + error.message, date: parsed.date, company: parsed.company });
        } else {
          results.push({ filename: file.name, status: "saved", date: parsed.date, company: parsed.company });
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
