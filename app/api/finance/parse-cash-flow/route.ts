import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { parseCashFlowPDF } from "../../../lib/pdf-parsers/cash-flow-parser";
import { parseBankPositionPDF } from "../../../lib/pdf-parsers/bank-position-parser";
import { reconcile } from "../../../lib/pdf-parsers/reconcile";
import { UTPL_COMPANY_ID, IFPL_COMPANY_ID, getCompanyById } from "../../../lib/constants";
import { requireAuth } from "../../../lib/api-auth";

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

    const cashFlow = await parseCashFlowPDF(cashFlowBuffer);
    const bankPosition = await parseBankPositionPDF(bankPositionBuffer);

    const detectedCompanyId = cashFlow.company === "imperial" ? IFPL_COMPANY_ID : UTPL_COMPANY_ID;
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

    const result = reconcile(cashFlow, bankPosition);
    const positionDate = cashFlow.date || bankPosition.date;

    if (!positionDate) {
      return Response.json(
        { error: "Could not extract a date from either PDF. Please check the files." },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Save daily cash position
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
        uploaded_by: formData.get("uploadedBy") as string || "manual",
        reconciled: result.matches,
      },
      { onConflict: "company_id,position_date" }
    );

    if (cashError) {
      return Response.json(
        { error: "Failed to save cash flow data: " + cashError.message },
        { status: 500 }
      );
    }

    // Save bank position snapshot
    const { error: bankError } = await supabase.from("bank_position_snapshots").upsert(
      {
        company_id: companyId,
        position_date: positionDate,
        ...bankPosition.banks,
        total_available_balance: bankPosition.totalAvailableBalance,
        post_dated_cheques_total: bankPosition.postDatedCHQsTotal,
        post_dated_currency: bankPosition.postDatedCurrency,
        raw_pdf_filename: bankPositionFile.name,
        uploaded_by: formData.get("uploadedBy") as string || "manual",
        reconciled: result.matches,
        reconcile_notes: result.matches
          ? "Balanced"
          : `Mismatch: cash flow closing ${result.cashFlowClosing.toLocaleString()} vs bank total ${result.bankPositionTotal.toLocaleString()} (diff: ${result.diff.toLocaleString()})`,
      },
      { onConflict: "company_id,position_date" }
    );

    if (bankError) {
      return Response.json(
        { error: "Failed to save bank position data: " + bankError.message },
        { status: 500 }
      );
    }

    return Response.json({
      success: true,
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: "Parse failed: " + message }, { status: 500 });
  }
}
