import { extractTextFromPDF } from "./extract-text";

export type BankPositionParsed = {
  date: string | null;
  banks: Record<string, number>;
  totalAvailableBalance: number;
  postDatedCHQsTotal: number;
  postDatedCurrency: string;
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

function detectCurrency(text: string): string {
  if (/£/.test(text)) return "GBP";
  if (/\$/.test(text)) return "USD";
  if (/€/.test(text)) return "EUR";
  return "PKR";
}

export async function parseBankPositionPDF(buffer: Buffer): Promise<BankPositionParsed> {
  const text = await extractTextFromPDF(buffer);

  // The bank position PDF lists bank names followed by their balance values
  // The "Available Balance" section has the final balances in order
  // Extract from the Available Balance section
  const availableIdx = text.indexOf("Available Balance");
  const totalIdx = text.indexOf("Total Available Balance");

  let balanceBlock = "";
  if (availableIdx >= 0 && totalIdx >= 0) {
    balanceBlock = text.slice(availableIdx + 17, totalIdx);
  }

  // Extract numbers from the balance block
  const numbers = balanceBlock.match(/[\d,]+(?:\.\d+)?/g) || [];
  const balances = numbers.map((n) => parseAmount(n));

  // Map to bank columns in order
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

  // Total Available Balance
  const totalMatch = text.match(/Total Available Balance\s*([\d,]+(?:\.\d+)?)/i);
  const totalAvailableBalance = totalMatch ? parseAmount(totalMatch[1]) : 0;

  // Post Dated CHQs
  const pdMatch = text.match(/Post Dated CHQ['']?s?\s*[£$€]?\s*([\d,]+(?:\.\d+)?)/i);
  const postDatedCHQsTotal = pdMatch ? parseAmount(pdMatch[1]) : 0;

  // Detect currency near post-dated
  const pdIdx = text.toLowerCase().indexOf("post dated");
  const pdSection = pdIdx >= 0 ? text.slice(pdIdx, pdIdx + 50) : "";

  return {
    date: extractDate(text),
    banks,
    totalAvailableBalance,
    postDatedCHQsTotal,
    postDatedCurrency: detectCurrency(pdSection),
    rawText: text,
  };
}
