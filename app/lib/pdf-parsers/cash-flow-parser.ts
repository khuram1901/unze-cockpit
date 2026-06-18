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

function parseAmount(text: string): number {
  const cleaned = text.replace(/,/g, "").replace(/\s/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function extractDate(text: string): string | null {
  const m = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function findAmount(text: string, label: string): number {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Pattern: label followed by numbers (with commas/spaces)
  const patterns = [
    new RegExp(escaped + "\\s*([\\d,]+(?:\\.\\d+)?)", "i"),
    new RegExp(escaped + "[\\s\\S]{0,20}?([\\d,]{4,}(?:\\.\\d+)?)", "i"),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return parseAmount(m[1]);
  }
  return 0;
}

export async function parseCashFlowPDF(buffer: Buffer): Promise<CashFlowParsed> {
  const text = await extractTextFromPDF(buffer);

  // Find the Payments total — look for "Total" after "Payments" section
  const paymentsSection = text.indexOf("Payments");
  const receiptsSection = text.indexOf("Receipts");
  let paymentsTotal = 0;
  if (paymentsSection >= 0 && receiptsSection >= 0) {
    const payBlock = text.slice(paymentsSection, receiptsSection);
    const totalMatch = payBlock.match(/Total\s*([\d,]+(?:\.\d+)?)/i);
    if (totalMatch) paymentsTotal = parseAmount(totalMatch[1]);
  }

  // Find Receipts total
  const closingIdx = text.indexOf("Closing Balance Unze Trading");
  let receiptsTotal = 0;
  if (receiptsSection >= 0 && closingIdx >= 0) {
    const recBlock = text.slice(receiptsSection, closingIdx);
    const totalMatch = recBlock.match(/Total\s*([\d,]+(?:\.\d+)?)/i);
    if (totalMatch) receiptsTotal = parseAmount(totalMatch[1]);
  }

  // Loan & Post Dated total
  const loanSection = text.indexOf("Loan & Post Dated");
  const closingAfterIdx = text.indexOf("Closing Balance After");
  let loanTotal = 0;
  if (loanSection >= 0 && closingAfterIdx >= 0) {
    const loanBlock = text.slice(loanSection, closingAfterIdx);
    const totalMatch = loanBlock.match(/Total\s*([\d,]+(?:\.\d+)?)/i);
    if (totalMatch) loanTotal = parseAmount(totalMatch[1]);
  }

  return {
    openingBalanceTotal: findAmount(text, "Opening Balance Total"),
    paymentsTotal,
    receiptsTotal,
    closingBalanceUnzeTrading: findAmount(text, "Closing Balance Unze Trading"),
    loanPostDatedCHQs: loanTotal,
    closingAfterLoanPostDated: findAmount(text, "Closing Balance After Loan & Post Dated CHQ's Unze Trading"),
    date: extractDate(text),
    rawText: text,
  };
}
