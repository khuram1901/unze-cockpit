import { extractTextFromPDF } from "./extract-text";

export type CashFlowParsed = {
  openingBalanceTotal: number;
  paymentsTotal: number;
  receiptsTotal: number;
  closingBalanceUnzeTrading: number;
  loanPostDatedCHQs: number;
  closingAfterLoanPostDated: number;
  date: string | null;
  rawText: string;
};

function extractNumber(text: string, label: string): number {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(escaped + `[:\\s]+([\\d,]+\\.?\\d*)`, "i"),
    new RegExp(escaped + `\\s+(-?[\\d,]+\\.?\\d*)`, "i"),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      return parseFloat(m[1].replace(/,/g, "")) || 0;
    }
  }
  return 0;
}

function extractDate(text: string): string | null {
  const m = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (!m) return null;
  const [, a, b, year] = m;
  const day = a.length <= 2 && Number(a) <= 31 ? a.padStart(2, "0") : b.padStart(2, "0");
  const month = a === day ? b.padStart(2, "0") : a.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function parseCashFlowPDF(buffer: Buffer): Promise<CashFlowParsed> {
  const text = await extractTextFromPDF(buffer);

  return {
    openingBalanceTotal: extractNumber(text, "Opening Balance Total"),
    paymentsTotal: extractNumber(text, "Payments") || extractNumber(text, "Total Payments"),
    receiptsTotal: extractNumber(text, "Receipts") || extractNumber(text, "Total Receipts"),
    closingBalanceUnzeTrading: extractNumber(text, "Closing Balance Unze Trading") || extractNumber(text, "Closing Balance"),
    loanPostDatedCHQs: extractNumber(text, "Loan & Post-Dated CHQs") || extractNumber(text, "Loan & Post Dated"),
    closingAfterLoanPostDated: extractNumber(text, "Closing Balance After Loan & Post-Dated CHQs") || extractNumber(text, "Closing After"),
    date: extractDate(text),
    rawText: text,
  };
}
