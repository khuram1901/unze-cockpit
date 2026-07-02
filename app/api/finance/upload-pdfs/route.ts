import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { parseCashFlowPDF } from "../../../lib/pdf-parsers/cash-flow-parser";
import { parseBankPositionPDF } from "../../../lib/pdf-parsers/bank-position-parser";
import { reconcile, matchBankPositionToCashFlow } from "../../../lib/pdf-parsers/reconcile";
import { archiveSourceDocument } from "../../../lib/document-archive";
import { UTPL_COMPANY_ID, IFPL_COMPANY_ID } from "../../../lib/constants";

type FileResult = {
  filename: string;
  status: string;
  date?: string;
  company?: string;
};

function isCashFlow(name: string) { return /cash.?flow/i.test(name); }
function isBankPosition(name: string) { return /bank.?position/i.test(name); }
function extractDate(name: string): string | null {
  const m = name.match(/(\d{2})-(\d{2})-(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}
function filePrefix(name: string) {
  return name.toLowerCase().includes("unze") ? "unze" : "imperial";
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const formData = await request.formData().catch(() => null);
  if (!formData) return Response.json({ error: "Invalid form data" }, { status: 400 });

  const files = formData.getAll("files") as File[];
  if (files.length === 0) return Response.json({ error: "No files provided" }, { status: 400 });

  // Separate into cash flows and bank positions, grouped by date+company prefix
  type PdfEntry = { name: string; data: Buffer };
  type Group = { cashFlow?: PdfEntry; bankPosition?: PdfEntry };
  const groups = new Map<string, Group>();
  const unmatched: PdfEntry[] = [];

  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(".pdf")) continue;
    const buf = Buffer.from(await file.arrayBuffer());
    const date = extractDate(file.name);
    const prefix = filePrefix(file.name);

    if (date && (isCashFlow(file.name) || isBankPosition(file.name))) {
      const key = `${date}|${prefix}`;
      if (!groups.has(key)) groups.set(key, {});
      const g = groups.get(key)!;
      if (isCashFlow(file.name) && !g.cashFlow) g.cashFlow = { name: file.name, data: buf };
      else if (isBankPosition(file.name) && !g.bankPosition) g.bankPosition = { name: file.name, data: buf };
    } else {
      unmatched.push({ name: file.name, data: buf });
    }
  }

  // Also handle unmatched files — try parsing as cash flow
  for (const f of unmatched) {
    const key = `unknown|${filePrefix(f.name)}`;
    if (!groups.has(key)) groups.set(key, {});
    const g = groups.get(key)!;
    if (!g.cashFlow) g.cashFlow = f;
    else if (!g.bankPosition) g.bankPosition = f;
  }

  const results: FileResult[] = [];

  for (const [, group] of groups) {
    if (!group.cashFlow) continue;

    try {
      const cashFlowResults = await parseCashFlowPDF(group.cashFlow.data);
      const company = cashFlowResults[0]?.company || "unknown";
      const companyId = company === "imperial" ? IFPL_COMPANY_ID : UTPL_COMPANY_ID;

      await archiveSourceDocument({
        supabase, buffer: group.cashFlow.data, filename: group.cashFlow.name,
        docType: "cash_flow", companyId,
        positionDate: cashFlowResults[0]?.date || null,
        source: "manual", uploadedBy: auth.email,
      });

      let bankPositionResults = null;
      if (group.bankPosition) {
        try {
          bankPositionResults = await parseBankPositionPDF(group.bankPosition.data);
          await archiveSourceDocument({
            supabase, buffer: group.bankPosition.data, filename: group.bankPosition.name,
            docType: "bank_position", companyId,
            positionDate: bankPositionResults[0]?.date || null,
            source: "manual", uploadedBy: auth.email,
          });
        } catch {
          results.push({ filename: group.bankPosition.name, status: "error — bank position parse failed", company });
          bankPositionResults = null;
        }
      }

      for (const cashFlow of cashFlowResults) {
        const positionDate = cashFlow.date;
        if (!positionDate) {
          results.push({ filename: group.cashFlow!.name, status: "error — no date found in PDF", company });
          continue;
        }

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
          uploaded_by: auth.email,
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
            uploaded_by: auth.email,
            reconciled: rec?.matches ?? null,
            reconcile_notes: rec
              ? (rec.matches ? "Balanced" : `Mismatch: cash flow closing ${rec.cashFlowClosing.toLocaleString()} vs bank total ${rec.bankPositionTotal.toLocaleString()} (diff: ${rec.diff.toLocaleString()})`)
              : "No bank position uploaded",
          }, { onConflict: "company_id,position_date" });
        }

        if (error) {
          results.push({ filename: group.cashFlow!.name, status: "error — " + error.message, date: positionDate, company });
        } else {
          const label = rec ? (rec.matches ? "saved — balanced" : "saved — not balanced (check figures)") : "saved — cash flow only";
          results.push({ filename: group.cashFlow!.name, status: label, date: positionDate, company });
          if (group.bankPosition && bankPositionResults) {
            results.push({ filename: group.bankPosition.name, status: "saved", date: positionDate, company });
          }
        }
      }
    } catch (e) {
      results.push({ filename: group.cashFlow.name, status: "error — " + (e instanceof Error ? e.message : "parse failed") });
    }
  }

  const saved = results.filter((r) => r.status.startsWith("saved")).length;
  const errors = results.filter((r) => r.status.startsWith("error")).length;
  return Response.json({ ok: true, total: files.length, saved, errors, results });
}
