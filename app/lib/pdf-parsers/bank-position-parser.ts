import { extractTextFromPDF } from "./extract-text";

export type BankPositionParsed = {
  date: string | null;
  banks: Record<string, number>;
  totalAvailableBalance: number;
  postDatedCHQsTotal: number;
  postDatedCurrency: string;
  company: "unze" | "imperial";
  rawText: string;
};

function parseAmount(text: string): number {
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

function detectCurrency(text: string): string {
  if (/£/.test(text)) return "GBP";
  if (/\$/.test(text)) return "USD";
  if (/€/.test(text)) return "EUR";
  return "PKR";
}

function detectCompany(text: string): "unze" | "imperial" {
  const lower = text.toLowerCase();
  if (lower.includes("imperial")) return "imperial";
  return "unze";
}

function parseUnzeBankPosition(text: string): BankPositionParsed {
  // The bank position PDF lists bank names followed by their balance values.
  // The "Available Balance" section has the final balances in order.
  const availableIdx = text.indexOf("Available Balance");
  const totalIdx = text.indexOf("Total Available Balance");

  let balanceBlock = "";
  if (availableIdx >= 0 && totalIdx >= 0) {
    balanceBlock = text.slice(availableIdx + 17, totalIdx);
  }

  const numbers = balanceBlock.match(/[\d,]+(?:\.\d+)?/g) || [];
  const balances = numbers.map((n) => parseAmount(n));

  const bankKeys = [
    "cash_at_office",
    "js_bank_unze_trading",
    "askari_bank_saving",
    "allied_bank_unze_trading",
    "dib_bank",
    "silk_bank_saving",
    "mcb_unze_trading",
    "askari_saving_1489",
    "askari_saving_unze_trading",
    "hbl_pf_unze_trading",
    "meezan_bank_unze_trading",
    "hbl_unze_trading",
    "hbl_h_unze_trading",
    "faysal_bank_unze_trading",
  ];

  const banks: Record<string, number> = {};
  for (let i = 0; i < bankKeys.length; i++) {
    banks[bankKeys[i]] = i < balances.length ? balances[i] : 0;
  }

  const totalMatch = text.match(/Total Available Balance\s*([\d,]+(?:\.\d+)?)/i);
  const totalAvailableBalance = totalMatch ? parseAmount(totalMatch[1]) : 0;

  const pdMatch = text.match(/Post Dated CHQ['']?s?\s*[£$€]?\s*([\d,]+(?:\.\d+)?)/i);
  const postDatedCHQsTotal = pdMatch ? parseAmount(pdMatch[1]) : 0;

  const pdIdx = text.toLowerCase().indexOf("post dated");
  const pdSection = pdIdx >= 0 ? text.slice(pdIdx, pdIdx + 50) : "";

  return {
    date: extractDate(text),
    banks,
    totalAvailableBalance,
    postDatedCHQsTotal,
    postDatedCurrency: detectCurrency(pdSection),
    company: "unze",
    rawText: text,
  };
}

// Imperial bank position blocks start with a "DD/MM/YYYY" line and run until the
// next date line (or end of text). Per-bank columns aren't reliably attributable
// from extracted text (labels and values don't line up 1:1), so only the
// Total Available Balance is parsed for Imperial — that's the figure used for
// reconciliation against the cash-flow closing balance.
const IMPERIAL_BLOCK_SPLIT = /(?=^\d{2}\/\d{2}\/\d{4}$)/m;

function parseImperialBlock(block: string): BankPositionParsed {
  const totalMatch = block.match(/Total Available Balance[\s\S]{0,20}?\(?(-?[\d,]+(?:\.\d+)?)\)?/i);
  let totalAvailableBalance = totalMatch ? parseAmount(totalMatch[1]) : 0;
  if (totalMatch) {
    const idx = block.indexOf(totalMatch[0]);
    const chunk = block.slice(idx, idx + totalMatch[0].length + 5);
    if (chunk.includes("(") && chunk.includes(")")) totalAvailableBalance = -Math.abs(totalAvailableBalance);
  }

  return {
    date: extractDate(block),
    banks: {},
    totalAvailableBalance,
    postDatedCHQsTotal: 0,
    postDatedCurrency: "PKR",
    company: "imperial",
    rawText: block,
  };
}

function checkNotZero(result: BankPositionParsed): void {
  if (result.totalAvailableBalance === 0) {
    throw new Error(`Bank position PDF parsed but all balances are zero — likely unreadable or unsupported format (${result.date || "no date"})`);
  }
}

export async function parseBankPositionPDF(buffer: Buffer): Promise<BankPositionParsed[]> {
  const text = await extractTextFromPDF(buffer);
  const company = detectCompany(text);

  if (company === "unze") {
    const result = parseUnzeBankPosition(text);
    checkNotZero(result);
    return [result];
  }

  const blocks = text.split(IMPERIAL_BLOCK_SPLIT).filter((b) => /Total Available Balance/.test(b));
  if (blocks.length === 0) {
    const date = extractDate(text);
    throw new Error(`Could not find any "Total Available Balance" blocks in this Imperial bank position PDF (${date || "no date"})`);
  }

  return blocks.map((block) => {
    const result = parseImperialBlock(block);
    checkNotZero(result);
    return result;
  });
}
