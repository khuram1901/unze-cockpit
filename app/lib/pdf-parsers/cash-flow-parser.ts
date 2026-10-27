import { extractTextFromPDF } from "./extract-text";

export type PdcBucket = { dueDate: string; amount: number; label: string | null };

export type CashFlowTransaction = {
  txn_type: string;
  description: string;
  amount: number;
  rawStr?: string; // internal: the amount as printed (used to repair glued digits)
};

export type CashFlowParsed = {
  openingBalanceTotal: number;
  paymentsTotal: number;
  receiptsTotal: number;
  closingBalanceUnzeTrading: number;
  loanPostDatedCHQs: number;
  closingAfterLoanPostDated: number;
  pdcBuckets: PdcBucket[];
  transactions: CashFlowTransaction[];
  date: string | null;
  company: "unze" | "imperial" | "baranh" | "dolci" | "kkj" | "unknown";
  rawText: string;
  // 21/10/2026: whether the section's own "Total" line was found. A sheet with
  // no payments (or no receipts) prints "Total  -", which is a real zero, not
  // an unreadable figure — the pre-save check must not confuse the two.
  totalsFound: { payments: boolean; receipts: boolean };
};

function parseAmount(text: string): number {
  // Handle negative amounts in parentheses like (4,168,201) or -(4,168,201)
  // and plain minus prefixes like -904,994
  const trimmed = text.trim();
  const isNegative = trimmed.startsWith("(") || trimmed.startsWith("-");
  const cleaned = trimmed.replace(/[(),-\s]/g, "");
  const num = parseFloat(cleaned.replace(/,/g, ""));
  if (isNaN(num)) return 0;
  return isNegative ? -num : num;
}

// Extract a number (possibly negative in parens) that immediately follows a label on the same line
// e.g. "Today Opening Balance(16,333,132)" or "Today Opening Balance 16,333,132"
function extractInlineAmount(text: string, label: string): number | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Capture optional leading minus/paren prefix then the digit string.
  // Handles: "1,234", "(1,234)", "-(1,234)", "-1,234"
  const re = new RegExp(escaped + "\\s*(-?\\(?)([ \\d,]+(?:\\.\\d+)?)\\)?", "i");
  const m = text.match(re);
  if (!m) return null;
  const prefix = m[1] ?? "";
  const isNeg = prefix.includes("-") || prefix.includes("(");
  return isNeg ? -parseAmount(m[2]) : parseAmount(m[2]);
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
  // Capture an optional leading "-" or "(" before the digits so negative
  // opening/closing balances (e.g. -904,994) are preserved correctly.
  const patterns = [
    new RegExp(escaped + "\\s*(-?\\(?)([ \\d,]+(?:\\.\\d+)?)\\)?", "i"),
    new RegExp(escaped + "[\\s\\S]{0,20}?(-?\\(?)([ \\d,]{4,}(?:\\.\\d+)?)\\)?", "i"),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const prefix = m[1] ?? "";
      const digits = m[2] ?? "";
      const isNegative = prefix.includes("-") || prefix.includes("(");
      const num = parseFloat(digits.replace(/[,\s]/g, ""));
      if (isNaN(num)) continue;
      return isNegative ? -num : num;
    }
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

// Restaurant companies (Baranh / HD) PDC: simple date+amount pairs
// between the PDC header and the "Total PDC's Balance" line.
function extractRestaurantPdcBuckets(text: string): PdcBucket[] {
  const startIdx = text.search(/Post\s*Dated\s*CHQs/i);
  const totalIdx = text.search(/Total\s+PDC[''']?s?\s+Balance/i);
  if (startIdx < 0) return [];
  const end = totalIdx > startIdx ? totalIdx : text.length;
  const block = text.slice(startIdx, end);
  const buckets: PdcBucket[] = [];
  const re = /(\d{2})\/(\d{2})\/(\d{4})\s+(.+?)\s+([\d,]+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    buckets.push({ dueDate: `${m[3]}-${m[2]}-${m[1]}`, label: m[4].trim(), amount: parseAmount(m[5]) });
  }
  return buckets;
}

// ── Transaction line-item extraction ─────────────────────────────────────────
// Extracts every "DD/MM/YYYY  <description>  <amount>" row from a Payments or
// Receipts section. pdf-parse emits each row as a date line followed by the
// description with the amount glued to (or wrapping under) it, e.g.:
//   "28/07/2026\nCash paid against petty cash19,140"
//   "28/07/2026\nCash paid against 765-Z LESCO Bill Jul-26(https://…)\n165,953"
// The amount is always the LAST comma-grouped (or plain) number in the row's
// chunk; everything before it is the description. Rows are validated against
// the section's own "Total" line — a mismatch is reported via the returned
// `sumMatchesTotal` flag rather than dropping data (best-effort principle).
//
// 26/10/2026: pdf-parse column-ordering quirk — on some PDFs the right-column
// amount for a row is emitted BEFORE the date+description text, e.g.:
//   "264,594\n21/10/2026\nNASIR IQBAL/FARHEEN NASIR Rent - Oct-26 = PKR\n"
// In this layout the chunk-after-date has no comma-grouped number. We handle
// it by also looking at the text that precedes the date (the "pre-date tail")
// for a valid comma-grouped amount when the post-date chunk has none.
function extractSectionTransactions(
  sectionText: string,
  txnType: "payment" | "receipt",
): { rows: CashFlowTransaction[]; sumMatchesTotal: boolean; sectionTotal: number } {
  // Cut the section at its Total line so the total is never read as a row
  // amount. 22/10/2026: "Total  -" (no rows that day) must cut too — before,
  // the digits-only pattern missed it and the next heading ("Closing Balance
  // Unze Trading 111,827,701") was swallowed as a fake receipt row.
  const totalMatch = sectionText.match(/(?:^|\n)[#\s]*Total\s*(-|\(?[\d,]+(?:\.\d+)?\)?)\s*(?:\n|$)/i);
  const sectionTotal = totalMatch && totalMatch[1] !== "-" ? parseAmount(totalMatch[1].replace(/[()]/g, "")) : 0;
  const rowsBlock = totalMatch ? sectionText.slice(0, totalMatch.index!) : sectionText;

  // 27/10/2026: Only treat a date as a new-row marker when it appears at the
  // START of a line (preceded by \n or the block start, plus optional spaces).
  // Dates embedded mid-description (e.g. "CEO Petty Cash 21/10/2026  17,100")
  // caused the parser to split one row into two: first half had no amount
  // (discarded), second half had no description (discarded) — dropping the row.
  const dateMatches = [...rowsBlock.matchAll(/(?:^|\n)\s*(\d{2})\/(\d{2})\/(\d{4})/gm)].map(m => {
    // Re-anchor index to point at the date digits, not the preceding \n/spaces
    const dateStart = m.index! + m[0].indexOf(m[1] + "/" + m[2] + "/" + m[3]);
    return { ...m, index: dateStart } as RegExpMatchArray;
  });
  const rows: CashFlowTransaction[] = [];

  for (let i = 0; i < dateMatches.length; i++) {
    const m = dateMatches[i];
    const chunkStart = m.index! + m[0].length;
    const chunkEnd = i + 1 < dateMatches.length ? dateMatches[i + 1].index! : rowsBlock.length;
    const chunk = rowsBlock.slice(chunkStart, chunkEnd);

    // Amount = last comma-grouped number in the chunk-after-date.
    // We prefer comma-grouped numbers over bare integers to avoid treating
    // year-digits like "26" (in "Sep - 26") as an amount.
    const commaNumRe = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?)/g;
    const commaMatches = [...chunk.matchAll(commaNumRe)];

    let last: RegExpMatchArray | null = commaMatches.length > 0
      ? commaMatches[commaMatches.length - 1]
      : null;
    let preDateAmount: number | null = null;

    // 26/10/2026: pdf-parse column-ordering quirk. On some PDFs the right-column
    // amount is emitted BEFORE the date+description, e.g.:
    //   "264,594\n21/10/2026\nNASIR IQBAL/FARHEEN NASIR Rent - Oct-26 = PKR\n"
    // When no comma-grouped number is in the post-date chunk, look at the text
    // immediately before the current date for a valid comma-grouped amount.
    if (!last) {
      const lookback = Math.max(0, m.index! - 60);
      const preTail = rowsBlock.slice(lookback, m.index!);
      const preMatches = [...preTail.matchAll(commaNumRe)];
      if (preMatches.length > 0) {
        const preLast = preMatches[preMatches.length - 1];
        const preAmt = parseAmount(preLast[1]);
        if (preAmt > 0) {
          preDateAmount = preAmt;
          // Treat the entire post-date chunk as description when amount was pre-date.
          last = { index: chunk.length, 0: "", 1: preLast[1] } as unknown as RegExpMatchArray;
        }
      }
    }

    // Final fallback: if still no amount found, look for any plain integer
    // ≥ 100 in the post-date chunk (avoids picking up year fragments like "26").
    if (!last) {
      const plainMatches = [...chunk.matchAll(/\b(\d{3,}(?:\.\d+)?)\b/g)];
      if (plainMatches.length > 0) {
        last = plainMatches[plainMatches.length - 1];
      }
    }

    if (!last) continue;
    const amount = preDateAmount ?? parseAmount(last[1]);
    if (amount <= 0) continue;

    const description = (preDateAmount !== null
      ? chunk  // entire post-date chunk is the description
      : chunk.slice(0, last.index)
    )
      .replace(/\s+/g, " ")
      .trim()
      // Trim trailing "= PKR" or "= Rs" currency markers (present in some PDF variants)
      .replace(/\s*=\s*(?:PKR|Rs\.?)\s*$/i, "")
      // Trim a dangling "(" or "-" left behind when the amount was glued to the description
      .replace(/[-(\s]+$/, "")
      .trim();
    if (!description) continue;

    rows.push({
      txn_type: txnType,
      description,
      amount,
      rawStr: preDateAmount !== null ? String(preDateAmount) : last[1],
    });
  }

  let sum = rows.reduce((a, r) => a + r.amount, 0);

  // 22/10/2026: pdf-parse sometimes glues digits from the description onto the
  // amount ("…HT 31260702000001" + "12" → 3126070200000112; "Oct-26" + "2,961"
  // → 262,961). When the rows don't tie to the section total, find the ONE row
  // whose corrected amount (a) makes the section tie exactly and (b) is the
  // tail of the printed digits. Both must hold, so nothing is ever invented.
  if (sectionTotal > 0 && Math.abs(sum - sectionTotal) >= 1) {
    const candidates = rows.filter((r) => {
      const fixed = sectionTotal - (sum - r.amount);
      if (fixed < 0 || fixed >= r.amount) return false;
      const printed = (r.rawStr ?? "").replace(/,/g, "");
      return printed.endsWith(String(Math.round(fixed)));
    });
    if (candidates.length === 1) {
      candidates[0].amount = sectionTotal - (sum - candidates[0].amount);
      sum = sectionTotal;
    }
  }
  for (const r of rows) delete r.rawStr;

  const sumMatchesTotal = sectionTotal > 0 && Math.abs(sum - sectionTotal) < 1;
  return { rows, sumMatchesTotal, sectionTotal };
}

// Locates the Payments and Receipts sections of a cash-flow text and extracts
// their transaction rows. Section headers appear as "DatePaymentsAmount" /
// "DateReceiptsAmount" (pdf-parse glues the column headers together), and each
// section ends at its own "Total" line. Works for Unze, Imperial, Baranh/Dolci
// and KKJ layouts, which all share this table shape.
export function extractTransactionsWithTieOut(text: string): { rows: CashFlowTransaction[]; paymentsTie: boolean; receiptsTie: boolean } {
  const out: CashFlowTransaction[] = [];
  let paymentsTie = false, receiptsTie = false;
  const payIdx = text.search(/Date\s*Payments/i);
  const recIdx = text.search(/Date\s*Receipts/i);
  const loanIdx = text.search(/Date\s*Loan\s*&\s*Post\s*Dated/i);
  if (payIdx >= 0) {
    const end = recIdx > payIdx ? recIdx : text.length;
    const r = extractSectionTransactions(text.slice(payIdx, end), "payment");
    out.push(...r.rows); paymentsTie = r.sumMatchesTotal || (r.sectionTotal === 0 && r.rows.length === 0);
  }
  if (recIdx >= 0) {
    const end = loanIdx > recIdx ? loanIdx : text.length;
    const r = extractSectionTransactions(text.slice(recIdx, end), "receipt");
    out.push(...r.rows); receiptsTie = r.sumMatchesTotal || (r.sectionTotal === 0 && r.rows.length === 0);
  }
  return { rows: out, paymentsTie, receiptsTie };
}

function extractAllTransactions(text: string): CashFlowTransaction[] {
  const out: CashFlowTransaction[] = [];

  const payIdx = text.search(/Date\s*Payments/i);
  const recIdx = text.search(/Date\s*Receipts/i);
  const loanIdx = text.search(/Date\s*Loan\s*&\s*Post\s*Dated/i);

  if (payIdx >= 0) {
    const end = recIdx > payIdx ? recIdx : text.length;
    const { rows } = extractSectionTransactions(text.slice(payIdx, end), "payment");
    out.push(...rows);
  }
  if (recIdx >= 0) {
    // Receipts section ends at the Loan/PDC section (Unze) or at the end marker
    const end = loanIdx > recIdx ? loanIdx : text.length;
    const { rows } = extractSectionTransactions(text.slice(recIdx, end), "receipt");
    out.push(...rows);
  }
  return out;
}

// ── Imperial-specific transaction extractor ────────────────────────────────────
// Imperial PDFs have a two-column layout where pdf-parse emits ALL date+
// description lines first (left column), followed by ALL amounts (right column)
// after the "Total" keywords. This means extractSectionTransactions — which cuts
// the rowsBlock at the Total line index — sees no amounts at all.
//
// Layout confirmed via pdfminer on Cash_Flow_21-10-2026.pdf (27/10/2026):
//   Date  Payments  Amount
//   Opening Balance  15,133,998
//   21/10/2026 PACKAGES REAL ESTATE (PVT) LTD     ← 13 payment desc lines
//   ...
//   Total                                          ← no amount here in left col
//   Receipts  Date
//   21/10/2026 Cash Sale Rvd from Shop in Faysal Bank  ← 11 receipt desc lines
//   ...
//   Total
//   Closing Balance  Date  Post Dated CHQs ...
//   (ALL AMOUNTS in a separate block here):
//   1,111,739                                      ← payment amounts (13)
//   ...
//   5,424,821                                      ← payment Total
//   Amount
//   1,525,214                                      ← receipt amounts (11)
//   ...
//   14,910,427                                     ← receipt Total
//
// Strategy: collect desc rows by ordinal position from each section's header→Total
// slice, then find the post-Total amount block and zip by index.
// knownPayTotal and knownRecTotal are the section totals already extracted by
// parseImperial — they come from the section Total lines in the amounts column
// (right side), which the descriptions-only block (left side) does not contain.
// Passing them in allows the amount-block walker to recognise where payment
// amounts end and receipt amounts begin without re-deriving the totals.
function extractImperialTransactions(
  text: string,
  knownPayTotal: number,
  knownRecTotal: number,
): CashFlowTransaction[] {
  // Only match dates at the start of a line — same fix as extractSectionTransactions.
  const dateRe = /(?:^|\n)\s*(\d{2})\/(\d{2})\/(\d{4})/gm;

  // ── Step 1: collect payment descriptions ──
  const payHeaderIdx = text.search(/Date\s*\n?\s*Payments/i);
  const firstTotalIdx = text.search(/(?:^|\n)\s*Total\s*(?:\n|$)/i);
  const recHeaderIdx = text.search(/Receipts\s*\n?\s*Date/i);
  const secondTotalIdx = (() => {
    if (firstTotalIdx < 0) return -1;
    const afterFirst = text.slice(firstTotalIdx + 5);
    const i = afterFirst.search(/(?:^|\n)\s*Total\s*(?:\n|$)/i);
    return i >= 0 ? firstTotalIdx + 5 + i : -1;
  })();

  const payDescriptions: string[] = [];
  const recDescriptions: string[] = [];

  // Helper: extract date-keyed descriptions from a section block.
  // dateRe anchors to line-start so mid-description dates are ignored;
  // chunkEnd points at the start of the NEXT date's leading \n/spaces.
  function collectDescs(block: string): string[] {
    const descs: string[] = [];
    const dms = [...block.matchAll(dateRe)];
    for (let i = 0; i < dms.length; i++) {
      const chunkStart = dms[i].index! + dms[i][0].length; // after the full match incl. \n+spaces
      const chunkEnd = i + 1 < dms.length ? dms[i + 1].index! : block.length;
      const desc = block.slice(chunkStart, chunkEnd).replace(/\s+/g, " ").trim();
      if (desc) descs.push(desc);
    }
    return descs;
  }

  // Payment descriptions: between "Date Payments" header and first "Total"
  if (payHeaderIdx >= 0 && firstTotalIdx > payHeaderIdx) {
    const payBlock = text.slice(payHeaderIdx, firstTotalIdx);
    payDescriptions.push(...collectDescs(payBlock));
  }

  // Receipt descriptions: between "Receipts Date" header and second "Total"
  if (recHeaderIdx >= 0) {
    const recEnd = secondTotalIdx > recHeaderIdx ? secondTotalIdx : text.length;
    const recBlock = text.slice(recHeaderIdx, recEnd);
    recDescriptions.push(...collectDescs(recBlock));
  }

  if (payDescriptions.length === 0 && recDescriptions.length === 0) return [];

  // ── Step 2: find the amount block — after the last "Total" keyword ──
  // The amounts appear as a block of comma-grouped numbers after both section
  // Totals. We identify the boundary as after the second Total line (or first
  // if only one section). Amounts are one per line, interleaved with section
  // totals (also comma-grouped) and "Amount" header labels.
  const amountBlockStart = secondTotalIdx >= 0
    ? secondTotalIdx
    : (firstTotalIdx >= 0 ? firstTotalIdx : -1);

  if (amountBlockStart < 0) return [];

  const amountBlock = text.slice(amountBlockStart);
  // Match comma-grouped numbers OR plain integers ≥ 3 digits (e.g. 450, 3,000).
  // Exclude calendar-year-like values (2020–2035) which appear from PDC section
  // date strings like "31/10/2026" that pdfminer/pdf-parse emit in the same block.
  const anyNumRe = /(?<!\d)((?:\d{1,3}(?:,\d{3})+|\d{3,})(?:\.\d+)?)(?!\d)/g;
  const isCalendarYear = (n: number) => n >= 2020 && n <= 2035;
  const allCommaNums = [...amountBlock.matchAll(anyNumRe)]
    .map(m => parseAmount(m[1]))
    .filter(n => n >= 100 && !isCalendarYear(n));

  // ── Step 3: Use the known section totals as phase markers ──
  // In Imperial PDFs the "Total" lines in the left-column (descriptions block)
  // carry no amount — amounts only appear in the right-column dump that starts
  // after both Totals. readSectionTotal on the descriptions block returns null.
  // Instead, use the totals already extracted by parseImperial (which correctly
  // reads the right-column amounts via anchored regex on the full text).
  const payTotalInBlock = knownPayTotal;
  const recTotalInBlock = knownRecTotal;

  // Walk the amount list and assign: first payDescriptions.length amounts → payments,
  // skipping any amount that equals the payment Total (section separator),
  // then recDescriptions.length amounts → receipts (skipping receipt Total and
  // anything after).
  const payAmounts: number[] = [];
  const recAmounts: number[] = [];
  let phase = "payment"; // payment → receipt
  let amtIdx = 0;

  while (amtIdx < allCommaNums.length) {
    const amt = allCommaNums[amtIdx];
    amtIdx++;

    if (phase === "payment") {
      if (payTotalInBlock > 0 && Math.abs(amt - payTotalInBlock) < 1) {
        // This is the payment Total line — switch to receipt phase
        phase = "receipt";
        continue;
      }
      if (payAmounts.length < payDescriptions.length) {
        payAmounts.push(amt);
      } else {
        // More amounts than descriptions — switch to receipt phase
        phase = "receipt";
        if (recDescriptions.length > 0 && (recTotalInBlock === 0 || Math.abs(amt - recTotalInBlock) >= 1)) {
          recAmounts.push(amt);
        }
      }
    } else {
      // receipt phase
      if (recTotalInBlock > 0 && Math.abs(amt - recTotalInBlock) < 1) break; // receipt Total — done
      if (recAmounts.length < recDescriptions.length) {
        recAmounts.push(amt);
      } else {
        break; // closing balance and beyond
      }
    }
  }

  // ── Step 4: zip descriptions with amounts ──
  const out: CashFlowTransaction[] = [];

  for (let i = 0; i < payDescriptions.length; i++) {
    const amount = payAmounts[i] ?? 0;
    if (amount > 0) {
      out.push({ txn_type: "payment", description: payDescriptions[i], amount });
    }
  }
  for (let i = 0; i < recDescriptions.length; i++) {
    const amount = recAmounts[i] ?? 0;
    if (amount > 0) {
      out.push({ txn_type: "receipt", description: recDescriptions[i], amount });
    }
  }

  return out;
}

// Reads the first "Total" line of a section block. Returns the amount, 0 when
// the sheet prints "-" (no rows that day), or null when no Total line exists.
// "#####" is Excel's column-overflow marker and may precede the word Total.
function readSectionTotal(block: string): number | null {
  const m = block.match(/(?:^|\n)[#\s]*Total\s*(-|\(?[\d,]+(?:\.\d+)?\)?)\s*(?:\n|$)/i);
  if (!m) return null;
  return m[1] === "-" ? 0 : parseAmount(m[1].replace(/[()]/g, ""));
}

// Slice of text between a section header and the next section header, so a
// section with no rows never borrows the NEXT section's Total line.
function sectionBlock(text: string, startRe: RegExp, endRes: RegExp[]): string | null {
  const start = text.search(startRe);
  if (start < 0) return null;
  let end = text.length;
  for (const re of endRes) {
    const i = text.slice(start + 1).search(re);
    if (i >= 0 && start + 1 + i < end) end = start + 1 + i;
  }
  return text.slice(start, end);
}

// ── Company detection ─────────────────────────────────────────────────────────

function detectCompany(text: string): CashFlowParsed["company"] {
  const lower = text.toLowerCase();

  // ── Unze Trading — check first; Unze cash flows sometimes mention "Imperial Footwear" as a payee
  if (lower.includes("opening balance total")) {
    // Could be Unze, Baranh, or Dolci — distinguish by entity name
    if (lower.includes("baranh (pvt) ltd") || lower.includes("baranh(pvt)ltd")) return "baranh";
    if (lower.includes("dolci resturants") || lower.includes("dolci restaurants") || lower.includes("haute dolci")) return "dolci";
    // Unze identifiers
    if (lower.includes("closing balance unze trading")) return "unze";
    if (lower.includes("unze trading pvt")) return "unze";
    // Fallback: if Opening Balance Total is present but no other identifier, lean toward baranh/dolci style
    return "baranh";
  }
  if (lower.includes("closing balance unze trading")) return "unze";
  if (lower.includes("unze trading pvt")) return "unze";

  // ── K&K Jhang ──
  if (lower.includes("k & k baranh jhang") || lower.includes("k&k baranh jhang") || lower.includes("k & k jhang")) return "kkj";

  // ── Imperial Footwear ──
  if (lower.includes("today opening balance") && lower.includes("today closing balance")) return "imperial";
  if (lower.includes("imperial footwear")) return "imperial";

  return "unknown";
}

// ── Parsers ───────────────────────────────────────────────────────────────────

function parseUnzeTrading(text: string, date: string | null): CashFlowParsed {
  const payBlock = sectionBlock(text, /Date\s*Payments/i, [/Date\s*Receipts/i, /Closing Balance/i]);
  const recBlock = sectionBlock(text, /Date\s*Receipts/i, [/Closing Balance/i, /Date\s*Loan/i]);
  const payRead = payBlock ? readSectionTotal(payBlock) : null;
  const recRead = recBlock ? readSectionTotal(recBlock) : null;
  const paymentsTotal = payRead ?? 0;
  const receiptsTotal = recRead ?? 0;

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
    transactions: extractAllTransactions(text),
    totalsFound: { payments: payRead !== null, receipts: recRead !== null },
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

  // Extract payments total using the anchored readSectionTotal helper, which
  // requires the Total line to start at a newline and be followed by a newline
  // or end-of-string. This prevents picking up an interleaved payment amount
  // that pdf-parse may emit on the same "line" as the section Total.
  // 26/10/2026: the simpler /Total\s+([\d,]+)/i regex was matching the wrong
  // number when pdf-parse column-ordering emitted a payment amount adjacent to
  // the Total keyword — e.g. "Total  307,020  5,424,821" read 307,020 instead
  // of 5,424,821, causing a 307,020 gap in the accounting equation.
  let payTotalRead: number | null = null;
  if (paymentsIdx >= 0) {
    const end = receiptsIdx > paymentsIdx ? receiptsIdx : (closingIdx > paymentsIdx ? closingIdx : text.length);
    const block = text.slice(paymentsIdx, end);
    payTotalRead = readSectionTotal(block);
  }
  let paymentsTotal = payTotalRead ?? 0;

  let recTotalRead: number | null = null;
  if (receiptsIdx >= 0) {
    const end = closingIdx > receiptsIdx ? closingIdx : text.length;
    const block = text.slice(receiptsIdx, end);
    recTotalRead = readSectionTotal(block);
  }
  let receiptsTotal = recTotalRead ?? 0;

  // ── Swap detection: some IFPL PDF dates have Payments/Receipts sections swapped ──
  // Guard: if equation fails by > 1000 but holds when swapped, swap them.
  const closingRaw =
    extractInlineAmount(text, "Today Closing Balance") ?? null;
  if (closingRaw !== null && paymentsTotal !== 0 && receiptsTotal !== 0) {
    const errNormal = Math.abs(openingBalance + receiptsTotal - paymentsTotal - closingRaw);
    const errSwapped = Math.abs(openingBalance + paymentsTotal - receiptsTotal - closingRaw);
    if (errSwapped < errNormal && errSwapped < 1000 && errNormal > 1000) {
      const tmp = paymentsTotal;
      paymentsTotal = receiptsTotal;
      receiptsTotal = tmp;
    }
  }
  // If paymentsTotal is still 0 and equation fails, derive from accounting equation
  if (paymentsTotal === 0 && closingRaw !== null && receiptsTotal !== 0) {
    const derived = openingBalance + receiptsTotal - closingRaw;
    if (derived > 0) paymentsTotal = derived;
  }

  // ── Closing balance ──
  // Format: "Today Closing Balance(15,731,695)" or "Closing Balance   (15,731,695)"
  const closingBalance =
    closingRaw ??
    (openingBalance + receiptsTotal - paymentsTotal);

  // ── PDC total ──
  // Format: "Total PDC's Balance  62,057,051"
  // Sign check: only look within the same line as "Total PDC" — a 60-char
  // lookahead bleeds into the following "Closing Balance\n(161,609,884)"
  // line and incorrectly treats that closing-balance "(" as a negative sign.
  let pdcTotal = 0;
  const pdcMatch = text.match(/Total\s+PDC[''']s\s+Balance\s+\(?([,\d]+(?:\.\d+)?)\)?/i);
  if (pdcMatch) {
    const pdcStart = text.search(/Total\s+PDC/i);
    const pdcLineEnd = text.indexOf("\n", pdcStart);
    const chunk = text.slice(pdcStart, pdcLineEnd >= 0 ? pdcLineEnd : pdcStart + 50);
    pdcTotal = chunk.includes("(") ? -parseAmount(pdcMatch[1]) : parseAmount(pdcMatch[1]);
  }

  // ── Closing after PDC ──
  // Last "Closing Balance" line — comes after the PDC section
  // Format: "Closing Balance\n(77,788,746)"
  let closingAfterPDC = closingBalance - pdcTotal; // fallback: closing minus PDC (PDC reduces available cash)
  const pdcSectionIdx = text.search(/Total\s+PDC/i);
  if (pdcSectionIdx >= 0) {
    const afterPDC = text.slice(pdcSectionIdx);
    const m = afterPDC.match(/Closing Balance\s*\n?\s*(-?\(?)\s*([,\d]+(?:\.\d+)?)\)?/i);
    if (m) {
      const chunk = afterPDC.slice(afterPDC.search(/Closing Balance/i), afterPDC.search(/Closing Balance/i) + 60);
      const impPrefix = m[1] ?? "";
      const impIsNeg = impPrefix.includes("-") || impPrefix.includes("(");
      closingAfterPDC = impIsNeg ? -parseAmount(m[2]) : parseAmount(m[2]);
    }
  }

  // ── Suspicious-parse guard ──
  // If all three of these are true simultaneously, the parser has produced a
  // result that looks internally consistent but is actually wrong:
  //   • openingBalance = 0  → "Today Opening Balance" label was found (for
  //     detectCompany) but extractInlineAmount couldn't read the number after it
  //   • closingRaw = null   → "Today Closing Balance" number wasn't extracted
  //   • paymentsTotal = 0   → "Date Payments" header wasn't found in the text
  //   • receiptsTotal > 0   → but some "Total" was matched in a receipts-shaped block
  // In this case closing = 0 + receipts − 0 = receipts, which gives a plausible
  // but incorrect result that passes checkNotMostlyZero (only 2 zeros, not 3).
  // This happens when pdf-parse produces a different text format from the one
  // the regexes were written for — typically a different PDF export variant.
  if (openingBalance === 0 && closingRaw === null && paymentsTotal === 0 && receiptsTotal > 0) {
    throw new Error(
      `Imperial PDF parsed but result is suspicious — opening=0, closing not found, payments=0, receipts=${receiptsTotal}. ` +
      `The PDF text format may differ from expected. ` +
      `Labels found: hasDayPayments=${/Date\s*Payments/i.test(text)}, ` +
      `hasDayReceipts=${/Date\s*Receipts/i.test(text)}, ` +
      `hasOpeningLabel=${/Today Opening Balance/i.test(text)}. ` +
      `Text starts: ${text.slice(0, 200).replace(/\n/g, "\\n")}`
    );
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
    // 27/10/2026: Imperial PDFs emit all descriptions first, then all amounts
    // in a separate column block after both "Total" lines. extractAllTransactions
    // (which calls extractSectionTransactions cutting at Total) sees no amounts
    // and produces wrong/empty rows. Use the Imperial-specific zip extractor instead.
    transactions: extractImperialTransactions(text, paymentsTotal, receiptsTotal),
    totalsFound: { payments: payTotalRead !== null, receipts: recTotalRead !== null },
  };
}

// Baranh (PVT) Ltd + Dolci Restaurants share the same PDF layout (confirmed
// via position-based extraction of real PDFs, 28/07/2026):
//
//   Opening Balance Total   <amount>        ← top-right
//   Payments section        amounts on right
//   Receipts section        amounts on right
//   Closing Balance Total   <amount>        ← middle-right
//   Post Dated CHQs section amounts on right
//   Total PDC's Balance     <pdc_total>
//   Closing Balance         (<closing_after_pdc>)   ← parens = negative
//
// The structure is identical to Unze Trading except:
//   • "Closing Balance Total" instead of "Closing Balance Unze Trading"
//   • No "Loan & Post Dated" header before PDC (just "Post Dated CHQs")
//   • No "Closing Balance After Loan & Post Dated CHQ's…" label
function parseBaranhStyle(
  text: string,
  date: string | null,
  company: "baranh" | "dolci",
): CashFlowParsed {
  const openingBalance = findAmount(text, "Opening Balance Total");

  // Each section is cut at whichever other header comes next (Receipts may
  // appear before OR after Payments in extracted text). 21/10/2026: a section
  // with no rows prints "Total  -"; previously the digits-only regex skipped it
  // and took the NEXT section's total, so HD showed payments = receipts.
  const payBlock = sectionBlock(text, /Date\s*Payments/i, [/Date\s*Receipts/i, /Closing Balance Total/i]);
  const recBlock = sectionBlock(text, /Date\s*Receipts/i, [/Date\s*Payments/i, /Closing Balance Total/i]);
  const payRead = payBlock ? readSectionTotal(payBlock) : null;
  const recRead = recBlock ? readSectionTotal(recBlock) : null;
  const paymentsTotal = payRead ?? 0;
  const receiptsTotal = recRead ?? 0;

  // Main closing balance (before PDC)
  const closingBalance = findAmount(text, "Closing Balance Total");

  // PDC total — "Total PDC's Balance  1,348,420"
  let pdcTotal = 0;
  const pdcMatch = text.match(/Total\s+PDC[''']?s?\s+Balance\s+\(?([,\d]+(?:\.\d+)?)\)?/i);
  if (pdcMatch) {
    const searchStart = text.search(/Total\s+PDC[''']?s?\s+Balance/i);
    const lineEnd = text.indexOf("\n", searchStart);
    const chunk = text.slice(searchStart, lineEnd >= 0 ? lineEnd : searchStart + 80);
    pdcTotal = chunk.includes("(") ? -parseAmount(pdcMatch[1]) : parseAmount(pdcMatch[1]);
  }

  // Closing balance after PDC — always use formula: closingBalance - pdcTotal.
  // BRNH PDFs print an incorrect value in the "Closing Balance" line after the PDC
  // section (they show |closing + pdc| instead of closing - pdc). Reading that line
  // overrides the correct result, so we do NOT read the PDF here.
  const closingAfterPDC = closingBalance - pdcTotal;

  return {
    openingBalanceTotal: openingBalance,
    paymentsTotal,
    receiptsTotal,
    closingBalanceUnzeTrading: closingBalance,
    loanPostDatedCHQs: pdcTotal,
    closingAfterLoanPostDated: closingAfterPDC,
    pdcBuckets: extractRestaurantPdcBuckets(text),
    date,
    company,
    rawText: text,
    transactions: extractAllTransactions(text),
    totalsFound: { payments: payRead !== null, receipts: recRead !== null },
  };
}

// K&K Baranh Jhang — simpler format (confirmed via real PDF, 28/07/2026):
//
//   Opening Balance     <amount>          ← no "Total" suffix
//   Payments section    amounts on right  (may be "-" = zero)
//   Receipts section    amounts on right
//   Closing Balance     <amount>          ← no PDC section
//
// No PDC section. Payments/Receipts totals end in a single "Total" line.
// When there are no payments the Total shows as "-" (treated as 0).
function parseKKJ(text: string, date: string | null): CashFlowParsed {
  // Opening: first number after "Opening Balance" (no "Total" in label)
  const openingBalance = (() => {
    const m = text.match(/Opening Balance\s*\n?\s*(-?[\d,]+(?:\.\d+)?)/i);
    return m ? parseAmount(m[1]) : 0;
  })();

  // Payments total: extract the "Total" line in the Payments section.
  // "-" means zero.
  const payBlock = sectionBlock(text, /Date\s*Payments/i, [/Date\s*Receipts/i, /Closing Balance/i]);
  const recBlock = sectionBlock(text, /Date\s*Receipts/i, [/Date\s*Payments/i, /Closing Balance/i]);
  const payRead = payBlock ? readSectionTotal(payBlock) : null;
  const recRead = recBlock ? readSectionTotal(recBlock) : null;
  const paymentsTotal = payRead ?? 0;
  const receiptsTotal = recRead ?? 0;

  // Closing balance: number after "Closing Balance" label
  const closingBalance = (() => {
    const m = text.match(/Closing Balance\s*\n?\s*(-?[\d,]+(?:\.\d+)?)/i);
    return m ? parseAmount(m[1]) : openingBalance + receiptsTotal - paymentsTotal;
  })();

  return {
    openingBalanceTotal: openingBalance,
    paymentsTotal,
    receiptsTotal,
    closingBalanceUnzeTrading: closingBalance,
    loanPostDatedCHQs: 0,
    closingAfterLoanPostDated: closingBalance,
    pdcBuckets: [],
    date,
    company: "kkj",
    rawText: text,
    transactions: extractAllTransactions(text),
    totalsFound: { payments: payRead !== null, receipts: recRead !== null },
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

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

// ── Public API ────────────────────────────────────────────────────────────────

export async function parseCashFlowPDF(buffer: Buffer): Promise<CashFlowParsed[]> {
  const text = await extractTextFromPDF(buffer);
  return parseCashFlowText(text);
}

export function parseCashFlowText(text: string): CashFlowParsed[] {
  const company = detectCompany(text);

  if (company === "unknown") {
    const date = extractDate(text);
    throw new Error(`Could not determine company from PDF contents — unrecognised format (${date || "no date"}). Supported: Unze Trading, Imperial Footwear, Baranh (PVT) Ltd, Dolci Restaurants, K&K Baranh Jhang.`);
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

  if (company === "imperial") {
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

  if (company === "baranh" || company === "dolci") {
    const date = extractDate(text);
    const result = parseBaranhStyle(text, date, company);
    checkNotMostlyZero(result, date, company);
    return [result];
  }

  if (company === "kkj") {
    const date = extractDate(text);
    const result = parseKKJ(text, date);
    checkNotMostlyZero(result, date, company);
    return [result];
  }

  // TypeScript exhaustiveness guard — never reached
  const date = extractDate(text);
  throw new Error(`Unhandled company type: ${company} (${date || "no date"})`);
}
