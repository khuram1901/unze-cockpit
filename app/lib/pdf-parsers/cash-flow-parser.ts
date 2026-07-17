import { extractTextFromPDF } from "./extract-text";

export type PdcBucket = { dueDate: string; amount: number; label: string | null };

export type CashFlowParsed = {
  openingBalanceTotal: number;
  paymentsTotal: number;
  receiptsTotal: number;
  closingBalanceUnzeTrading: number;
  loanPostDatedCHQs: number;
  closingAfterLoanPostDated: number;
  pdcBuckets: PdcBucket[];
  date: string | null;
  company: "unze" | "imperial" | "unknown";
  rawText: string;
};

function parseAmount(text: string): number {
  // Handle negative amounts in parentheses like (4,168,201) or -(4,168,201)
  const trimmed = text.trim();
  const isNegative = trimmed.startsWith("(") || trimmed.startsWith("-(");
  const cleaned = trimmed.replace(/[(),-\s]/g, "");
  const num = parseFloat(cleaned.replace(/,/g, ""));
  if (isNaN(num)) return 0;
  return isNegative ? -num : num;
}

// Extract a number (possibly negative in parens) that immediately follows a label on the same line
// e.g. "Today Opening Balance(16,333,132)" or "Today Opening Balance 16,333,132"
function extractInlineAmount(text: string, label: string): number | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match label followed immediately by optional space then optional ( then digits/commas then optional )
  const re = new RegExp(escaped + "\\s*\\(?([\\d,]+(?:\\.\\d+)?)\\)?", "i");
  const m = text.match(re);
  if (!m) return null;
  // Check if there's a ( before the digits
  const matchStart = text.indexOf(m[0]);
  const chunk = text.slice(matchStart, matchStart + m[0].length + 5);
  const isNeg = chunk.includes("(");
  return isNeg ? -parseAmount(m[1]) : parseAmount(m[1]);
}

// Picks the most-frequent DD/MM/YYYY date in the text, not just the first
// match. Found via a real Imperial PDF (3 Jul 2026): its "Today Opening/
// Closing Balance" header was mistakenly printed with the previous day's
// date (02/07/2026), while every one of its ~30 actual payment/receipt
// transaction rows correctly said 03/07/2026 — a mislabel in the bank's own
// report, not something we can fix at the source. Taking the first match
// picked up the wrong header date, silently mis-filed that whole day under
// the previous day's slot (and got skipped as a duplicate once that slot
// was already taken), so the real day vanished from the app entirely.
// Going with whichever date appears most often is far more reliable than a
// single header line, for both companies' report formats.
function extractDate(text: string): string | null {
  const matches = [...text.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)];
  if (matches.length === 0) return null;
  const counts = new Map<string, number>();
  for (const m of matches) {
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    counts.set(iso, (counts.get(iso) || 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [iso, count] of counts) {
    if (count > bestCount) { best = iso; bestCount = count; }
  }
  return best;
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

// Imperial's PDC table is a series of "(Total )?Balance DD/MM/YYYY\n<amount>"
// rows (a near-term bucket, then a single far-future catch-all — or more,
// on a day with a more spread-out schedule), ending in an untotalled
// "Total PDC's Balance" grand-total line which this deliberately does NOT
// match (no date directly follows "Balance" there — "PDC's" sits in
// between), so the grand total is never mistaken for another bucket.
function extractImperialPdcBuckets(text: string): PdcBucket[] {
  const startIdx = text.search(/Date\s*Post\s*Dated\s*CHQs/i);
  const totalIdx = text.search(/Total\s+PDC/i);
  if (startIdx < 0) return [];
  const end = totalIdx > startIdx ? totalIdx : text.length;
  const block = text.slice(startIdx, end);
  const buckets: PdcBucket[] = [];
  const re = /((?:Total\s+)?Balance)\s+(\d{2})\/(\d{2})\/(\d{4})\s*\n\s*([\d,]+(?:\.\d+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    buckets.push({ label: m[1].trim(), dueDate: `${m[4]}-${m[3]}-${m[2]}`, amount: parseAmount(m[5]) });
  }
  return buckets;
}

// Unze's PDC table is one row per cheque: a date line, a payee description
// (occasionally wrapping to a second line), then the amount, ending in an
// untotalled "Total <amount>" line. Splitting on each date and taking the
// LAST number before the next date (or the closing "Total" line) as that
// row's amount copes with the description wrapping without needing to
// parse the free-text payee name precisely.
function extractUnzePdcBuckets(text: string): PdcBucket[] {
  const startIdx = text.search(/Loan\s*&\s*Post\s*Dated/i);
  const endIdx = text.search(/Closing Balance After/i);
  if (startIdx < 0 || endIdx < 0) return [];
  const block = text.slice(startIdx, endIdx);
  const dateMatches = [...block.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)];
  const totalIdx = block.search(/\bTotal\b/i);
  const buckets: PdcBucket[] = [];
  for (let i = 0; i < dateMatches.length; i++) {
    const m = dateMatches[i];
    const chunkStart = m.index! + m[0].length;
    const nextDateIdx = i + 1 < dateMatches.length ? dateMatches[i + 1].index! : -1;
    const chunkEnd = nextDateIdx >= 0 ? nextDateIdx : (totalIdx >= 0 ? totalIdx : block.length);
    const chunk = block.slice(chunkStart, Math.max(chunkEnd, chunkStart));
    const numMatches = [...chunk.matchAll(/([\d,]+(?:\.\d+)?)/g)];
    const numMatch = numMatches[numMatches.length - 1];
    if (!numMatch) continue;
    const label = chunk.slice(0, numMatch.index).replace(/\s+/g, " ").trim() || null;
    buckets.push({ dueDate: `${m[3]}-${m[2]}-${m[1]}`, amount: parseAmount(numMatch[1]), label });
  }
  return buckets;
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
  // Check Unze first — Unze cash flows sometimes mention "Imperial Footwear" as a payee
  if (lower.includes("opening balance total")) return "unze";
  if (lower.includes("closing balance unze trading")) return "unze";
  if (lower.includes("unze trading pvt")) return "unze";
  if (lower.includes("today opening balance") && lower.includes("today closing balance")) return "imperial";
  if (lower.includes("imperial footwear")) return "imperial";
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
    pdcBuckets: extractUnzePdcBuckets(text),
    date,
    company: "unze",
    rawText: text,
  };
}

function parseImperial(text: string, date: string | null): CashFlowParsed {
  // ── Opening balance ──
  // Format: "Today Opening Balance(16,333,132)" or "Opening Balance(16,333,132)"
  const openingBalance =
    extractInlineAmount(text, "Today Opening Balance") ??
    extractInlineAmount(text, "Opening Balance") ??
    0;

  // ── Payments and Receipts totals ──
  // The PDF has a Payments section then a Receipts section.
  // Each ends with "Total   <amount>"
  // We find the index of "DatePayments" and "DateReceipts" to split the text.
  const paymentsIdx = text.search(/Date\s*Payments/i);
  const receiptsIdx = text.search(/Date\s*Receipts/i);
  const closingIdx = text.search(/Closing Balance\s*[\n\r(]/i);

  // Extract payments total — in the payments block
  let paymentsTotal = 0;
  if (paymentsIdx >= 0) {
    const end = receiptsIdx > paymentsIdx ? receiptsIdx : (closingIdx > paymentsIdx ? closingIdx : text.length);
    const block = text.slice(paymentsIdx, end);
    const m = block.match(/Total\s+([\d,]+(?:\.\d+)?)/i);
    if (m) paymentsTotal = parseAmount(m[1]);
  }

  // Extract receipts total — in the receipts block
  let receiptsTotal = 0;
  if (receiptsIdx >= 0) {
    const end = closingIdx > receiptsIdx ? closingIdx : text.length;
    const block = text.slice(receiptsIdx, end);
    const m = block.match(/Total\s+([\d,]+(?:\.\d+)?)/i);
    if (m) receiptsTotal = parseAmount(m[1]);
  }

  // ── Closing balance ──
  // Format: "Today Closing Balance(15,731,695)" or "Closing Balance   (15,731,695)"
  const closingBalance =
    extractInlineAmount(text, "Today Closing Balance") ??
    (openingBalance + receiptsTotal - paymentsTotal);

  // ── PDC total ──
  // Format: "Total PDC's Balance  62,057,051"
  let pdcTotal = 0;
  const pdcMatch = text.match(/Total\s+PDC[''’]s\s+Balance\s+\(?([,\d]+(?:\.\d+)?)\)?/i);
  if (pdcMatch) {
    const chunk = text.slice(text.search(/Total\s+PDC/i), text.search(/Total\s+PDC/i) + 60);
    pdcTotal = chunk.includes("(") ? -parseAmount(pdcMatch[1]) : parseAmount(pdcMatch[1]);
  }

  // ── Closing after PDC ──
  // Last "Closing Balance" line — comes after the PDC section
  // Format: "Closing Balance\n(77,788,746)"
  let closingAfterPDC = closingBalance - pdcTotal; // fallback: closing minus PDC (PDC reduces available cash)
  const pdcSectionIdx = text.search(/Total\s+PDC/i);
  if (pdcSectionIdx >= 0) {
    const afterPDC = text.slice(pdcSectionIdx);
    const m = afterPDC.match(/Closing Balance\s*\n?\s*\(?([,\d]+(?:\.\d+)?)\)?/i);
    if (m) {
      const chunk = afterPDC.slice(afterPDC.search(/Closing Balance/i), afterPDC.search(/Closing Balance/i) + 60);
      closingAfterPDC = chunk.includes("(") ? -parseAmount(m[1]) : parseAmount(m[1]);
    }
  }

  return {
    openingBalanceTotal: openingBalance,
    paymentsTotal,
    receiptsTotal,
    closingBalanceUnzeTrading: closingBalance,
    loanPostDatedCHQs: pdcTotal,
    closingAfterLoanPostDated: closingAfterPDC,
    pdcBuckets: extractImperialPdcBuckets(text),
    date,
    company: "imperial",
    rawText: text,
  };
}

function checkNotMostlyZero(result: CashFlowParsed, date: string | null, company: string): void {
  const criticalFields = [result.openingBalanceTotal, result.receiptsTotal, result.paymentsTotal, result.closingBalanceUnzeTrading];
  const zeroCount = criticalFields.filter((v) => v === 0).length;
  if (zeroCount >= 3) {
    throw new Error(`PDF parsed but most values are zero — likely unreadable or unsupported format (${date || "no date"}, ${company})`);
  }
}

// Imperial PDFs are sometimes batched with multiple days in one file. Each day's
// block starts with its "DD/MM/YYYY" line immediately followed by "Today Opening Balance".
const IMPERIAL_BLOCK_SPLIT = /(?=\d{2}\/\d{2}\/\d{4}\s*\nToday Opening Balance)/;

export async function parseCashFlowPDF(buffer: Buffer): Promise<CashFlowParsed[]> {
  const text = await extractTextFromPDF(buffer);
  const company = detectCompany(text);

  if (company === "unknown") {
    const date = extractDate(text);
    throw new Error(`Could not determine company (Unze Trading vs Imperial Footwear) from PDF contents — refusing to guess (${date || "no date"})`);
  }

  if (company === "unze") {
    const closingMatches = text.match(/Closing Balance Unze Trading/gi) || [];
    if (closingMatches.length > 1) {
      throw new Error(`This Unze Trading PDF appears to contain more than one day's data (${closingMatches.length} "Closing Balance" sections found) — multi-day Unze PDFs are not supported, please split and upload one day at a time`);
    }
    const date = extractDate(text);
    const result = parseUnzeTrading(text, date);
    checkNotMostlyZero(result, date, company);
    return [result];
  }

  const blocks = text.split(IMPERIAL_BLOCK_SPLIT).filter((b) => /Today Opening Balance/.test(b));
  if (blocks.length === 0) {
    const date = extractDate(text);
    throw new Error(`Could not find any "Today Opening Balance" blocks in this Imperial PDF (${date || "no date"})`);
  }

  const results = blocks.map((block) => {
    const date = extractDate(block);
    const result = parseImperial(block, date);
    checkNotMostlyZero(result, date, company);
    return result;
  });

  return results;
}
