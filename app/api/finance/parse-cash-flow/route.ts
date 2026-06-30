import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { parseCashFlowPDF } from "../../../lib/pdf-parsers/cash-flow-parser";
import { parseBankPositionPDF } from "../../../lib/pdf-parsers/bank-position-parser";
import { reconcile, matchBankPositionToCashFlow } from "../../../lib/pdf-parsers/reconcile";
import { UTPL_COMPANY_ID, IFPL_COMPANY_ID, getCompanyById } from "../../../lib/constants";
import { requireAuth } from "../../../lib/api-auth";
import { archiveSourceDocument } from "../../../lib/document-archive";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const formData = await request.formData();
    const cashFlowFile = formData.get("cashFlow") as File | null;
    const bankPositionFile = formData.get("bankPosition") as File | null;
    const companyId = (formData.get("companyId") as string) || UTPL_COMPANY_ID;

    if (!cashFlowFile || !bankPositionFile) {
      return Response.json(
        { error: "Both cashFlow and bankPosition PDF files are required." },
        { status: 400 }
      );
    }

    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per file
    if (cashFlowFile.size > MAX_FILE_SIZE || bankPositionFile.size > MAX_FILE_SIZE) {
      return Response.json({ error: "Each file must be under 10 MB." }, { status: 413 });
    }

    const cashFlowBuffer = Buffer.from(await cashFlowFile.arrayBuffer());
    const bankPositionBuffer = Buffer.from(await bankPositionFile.arrayBuffer());

    const cashFlowResults = await parseCashFlowPDF(cashFlowBuffer);
    const bankPositionResults = await parseBankPositionPDF(bankPositionBuffer);

    const detectedCompanyId = cashFlowResults[0].company === "imperial" ? IFPL_COMPANY_ID : UTPL_COMPANY_ID;
    if (detectedCompanyId !== companyId) {
      const expected = getCompanyById(companyId)?.name || companyId;
      const detected = getCompanyById(detectedCompanyId)?.name || detectedCompanyId;
      return Response.json(
        {
          error: `Company mismatch: this PDF was detected as "${detected}" but you're uploading to "${expected}". Upload it from the correct company tab.`,
        },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const uploadedBy = (formData.get("uploadedBy") as string) || "manual";

    await Promise.all([
      archiveSourceDocument({
        supabase,
        buffer: cashFlowBuffer,
        filename: cashFlowFile.name,
        docType: "cash_flow",
        companyId,
        positionDate: cashFlowResults[0]?.date || null,
        source: "manual",
        uploadedBy,
      }),
      archiveSourceDocument({
        supabase,
        buffer: bankPositionBuffer,
        filename: bankPositionFile.name,
        docType: "bank_position",
        companyId,
        positionDate: bankPositionResults[0]?.date || null,
        source: "manual",
        uploadedBy,
      }),
    ]);

    const days: {
      date: string;
      cashFlow: Record<string, number>;
      bankPosition: { banks: Record<string, number>; totalAvailable: number; postDatedCHQs: number; postDatedCurrency: string };
      reconciliation: ReturnType<typeof reconcile>;
    }[] = [];

    for (const cashFlow of cashFlowResults) {
      const bankPosition = matchBankPositionToCashFlow(cashFlow, bankPositionResults) || (cashFlowResults.length === 1 ? bankPositionResults[0] : undefined);

      if (!bankPosition) {
        return Response.json(
          {
            error: `No matching bank position day found for cash flow date ${cashFlow.date || "(unknown)"}. Bank position PDF has: ${bankPositionResults.map((b) => b.date).join(", ") || "no readable dates"}.`,
          },
          { status: 400 }
        );
      }

      const result = reconcile(cashFlow, bankPosition);
      const positionDate = cashFlow.date || bankPosition.date;

      if (!positionDate) {
        return Response.json(
          { error: "Could not extract a date from either PDF. Please check the files." },
          { status: 400 }
        );
      }

      const { error: cashError } = await supabase.from("daily_cash_position").upsert(
        {
          company_id: companyId,
          position_date: positionDate,
          opening_balance: cashFlow.openingBalanceTotal,
          total_receipts: cashFlow.receiptsTotal,
          total_payments: cashFlow.paymentsTotal,
          closing_balance: cashFlow.closingBalanceUnzeTrading,
          post_dated_total: cashFlow.loanPostDatedCHQs,
          closing_after_post_dated: cashFlow.closingAfterLoanPostDated,
          raw_pdf_filename: cashFlowFile.name,
          uploaded_by: uploadedBy,
          reconciled: result.matches,
        },
        { onConflict: "company_id,position_date" }
      );

      if (cashError) {
        return Response.json(
          { error: `Failed to save cash flow data for ${positionDate}: ` + cashError.message },
          { status: 500 }
        );
      }

      const { error: bankError } = await supabase.from("bank_position_snapshots").upsert(
        {
          company_id: companyId,
          position_date: positionDate,
          ...bankPosition.banks,
          total_available_balance: bankPosition.totalAvailableBalance,
          post_dated_cheques_total: bankPosition.postDatedCHQsTotal,
          post_dated_currency: bankPosition.postDatedCurrency,
          raw_pdf_filename: bankPositionFile.name,
          uploaded_by: uploadedBy,
          reconciled: result.matches,
          reconcile_notes: result.matches
            ? "Balanced"
            : `Mismatch: cash flow closing ${result.cashFlowClosing.toLocaleString()} vs bank total ${result.bankPositionTotal.toLocaleString()} (diff: ${result.diff.toLocaleString()})`,
        },
        { onConflict: "company_id,position_date" }
      );

      if (bankError) {
        return Response.json(
          { error: `Failed to save bank position data for ${positionDate}: ` + bankError.message },
          { status: 500 }
        );
      }

      days.push({
        date: positionDate,
        cashFlow: {
          openingBalance: cashFlow.openingBalanceTotal,
          receipts: cashFlow.receiptsTotal,
          payments: cashFlow.paymentsTotal,
          closingBalance: cashFlow.closingBalanceUnzeTrading,
          postDated: cashFlow.loanPostDatedCHQs,
          closingAfterPostDated: cashFlow.closingAfterLoanPostDated,
        },
        bankPosition: {
          banks: bankPosition.banks,
          totalAvailable: bankPosition.totalAvailableBalance,
          postDatedCHQs: bankPosition.postDatedCHQsTotal,
          postDatedCurrency: bankPosition.postDatedCurrency,
        },
        reconciliation: result,
      });
    }

    return Response.json({
      success: true,
      date: days[days.length - 1].date,
      cashFlow: days[days.length - 1].cashFlow,
      bankPosition: days[days.length - 1].bankPosition,
      reconciliation: days[days.length - 1].reconciliation,
      days,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: "Parse failed: " + message }, { status: 500 });
  }
}
