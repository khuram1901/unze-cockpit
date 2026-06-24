import { extractTextFromPDF } from "./extract-text";

export type CashFlowParsed = {
  openingBalanceTotal: number;
  paymentsTotal: number;
  receiptsTotal: number;
  closingBalanceUnzeTrading: number;
  loanPostDatedCHQs: number;
  closingAfterLoanPostDated: number;
  date: string | null;
  company: "unze" | "imperial" | "unknown";
  rawText: string;
};

function parseAmount(text: string): number {
  // Handle negative amounts in parentheses like (4,168,201)
  const isNegative = text.includes("(") && text.includes(")");
  const cleaned = text.replace(/[(),\s]/g, "");
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return isNegative ? -num : num;
}

function extractDate(text: string): string | null {
  const m = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function findAmount(text: string, label: string): number {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(escaped + "\\s*\\(?([ \\d,]+(?:\\.\\d+)?)\\)?", "i"),
    new RegExp(escaped + "[\\s\\S]{0,20}?\\(?([ \\d,]{4,}(?:\\.\\d+)?)\\)?", "i"),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return parseAmount(m[1]);
  }
  return 0;
}

function findTotalInSection(text: string, startLabel: string, endLabel: string): number {
  const startIdx = text.indexOf(startLabel);
  const endIdx = text.indexOf(endLabel);
  if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) return 0;
  const block = text.slice(startIdx, endIdx);
  const totalMatch = block.match(/Total\s*\(?([\d,]+(?:\.\d+)?)\)?/i);
  return totalMatch ? parseAmount(totalMatch[1]) : 0;
}

function detectCompany(text: string): "unze" | "imperial" | "unknown" {
  const lower = text.toLowerCase();
  if (lower.includes("imperial footwear")) return "imperial";
  if (lower.includes("unze trading")) return "unze";
  if (lower.includes("today opening balance") && lower.includes("today closing balance")) return "imperial";
  if (lower.includes("opening balance total")) return "unze";
  return "unknown";
}

function parseUnzeTrading(text: string, date: string | null): CashFlowParsed {
  const paymentsTotal = findTotalInSection(text, "Payments", "Receipts");

  const closingLabel = "Closing Balance Unze Trading";
  const closingIdx = text.indexOf(closingLabel);
  let receiptsTotal = 0;
  const receiptsIdx = text.indexOf("Receipts");
  if (receiptsIdx >= 0 && closingIdx >= 0) {
    const recBlock = text.slice(receiptsIdx, closingIdx);
    const m = recBlock.match(/Total\s*([\d,]+(?:\.\d+)?)/i);
    if (m) receiptsTotal = parseAmount(m[1]);
  }

  const loanSection = text.indexOf("Loan & Post Dated");
  const closingAfterIdx = text.indexOf("Closing Balance After");
  let loanTotal = 0;
  if (loanSection >= 0 && closingAfterIdx >= 0) {
    const loanBlock = text.slice(loanSection, closingAfterIdx);
    const m = loanBlock.match(/Total\s*([\d,]+(?:\.\d+)?)/i);
    if (m) loanTotal = parseAmount(m[1]);
  }

  return {
    openingBalanceTotal: findAmount(text, "Opening Balance Total"),
    paymentsTotal,
    receiptsTotal,
    closingBalanceUnzeTrading: findAmount(text, "Closing Balance Unze Trading"),
    loanPostDatedCHQs: loanTotal,
    closingAfterLoanPostDated: findAmount(text, "Closing Balance After Loan & Post Dated CHQ's Unze Trading"),
    date,
    company: "unze",
    rawText: text,
  };
}

function parseImperial(text: string, date: string | null): CashFlowParsed {
  const openingBalance = findAmount(text, "Today Opening Balance") || findAmount(text, "Opening Balance");

  // Find all "Total" amounts in order — payments first, receipts second
  const totalMatches: number[] = [];
  const totalRe = /Total\s+([\d,]+(?:\.\d+)?)/gi;
  let tm;
  while ((tm = totalRe.exec(text)) !== null) {
    totalMatches.push(parseAmount(tm[1]));
  }
  const paymentsTotal = totalMatches.length >= 1 ? totalMatches[0] : 0;
  const receiptsTotal = totalMatches.length >= 2 ? totalMatches[1] : 0;

  // Closing balance — handle negative in parentheses like (4,168,201)
  let closingBalance = 0;
  const closingArea = text.match(/Today Closing Balance\s*\(?([\d,]+(?:\.\d+)?)\)?/i);
  if (closingArea) {
    closingBalance = parseAmount(closingArea[1]);
    const chunk = text.slice(text.indexOf("Today Closing Balance"), text.indexOf("Today Closing Balance") + 80);
    if (chunk.includes("(") && chunk.includes(")")) closingBalance = -closingBalance;
  }
  if (closingBalance === 0) closingBalance = openingBalance + receiptsTotal - paymentsTotal;

  // Post-dated cheques
  const pdcMatch = text.match(/Total PDC['']s Balance\s+([\d,]+(?:\.\d+)?)/i);
  const pdcTotal = pdcMatch ? parseAmount(pdcMatch[1]) : 0;
  const closingAfterPDC = closingBalance - pdcTotal;

  return {
    openingBalanceTotal: openingBalance,
    paymentsTotal,
    receiptsTotal,
    closingBalanceUnzeTrading: closingBalance,
    loanPostDatedCHQs: pdcTotal,
    closingAfterLoanPostDated: closingAfterPDC,
    date,
    company: "imperial",
    rawText: text,
  };
}

export async function parseCashFlowPDF(buffer: Buffer): Promise<CashFlowParsed> {
  const text = await extractTextFromPDF(buffer);
  const date = extractDate(text);
  const company = detectCompany(text);

  const result = company === "imperial" ? parseImperial(text, date) : parseUnzeTrading(text, date);

  if (result.openingBalanceTotal === 0 && result.receiptsTotal === 0 && result.paymentsTotal === 0 && result.closingBalanceUnzeTrading === 0) {
    throw new Error(`PDF parsed but all values are zero — likely unreadable or unsupported format (${date || "no date"}, ${company})`);
  }

  return result;
}
