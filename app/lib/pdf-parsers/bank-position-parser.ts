import { extractTextFromPDF } from "./extract-text";

export type BankPositionParsed = {
  date: string | null;
  banks: Record<string, number>;
  totalAvailableBalance: number;
  postDatedCHQsTotal: number;
  postDatedCurrency: string;
  rawText: string;
};

const BANK_LABELS: { key: string; labels: string[] }[] = [
  { key: "cash_at_office", labels: ["Cash at Office", "Cash At Office"] },
  { key: "js_bank_unze_trading", labels: ["JS Bank Unze Trading", "JS Bank"] },
  { key: "askari_bank_saving", labels: ["Askari Bank Saving A/C", "Askari Bank Saving"] },
  { key: "allied_bank_unze_trading", labels: ["Allied Bank Unze Trading", "Allied Bank"] },
  { key: "dib_bank", labels: ["DIB Bank"] },
  { key: "silk_bank_saving", labels: ["Silk Bank Saving A/c", "Silk Bank Saving", "Silk Bank"] },
  { key: "mcb_unze_trading", labels: ["MCB Unze Trading", "MCB Bank"] },
  { key: "askari_saving_1489", labels: ["Askari Bank Saving A/C 1489", "Askari Saving 1489"] },
  { key: "askari_saving_unze_trading", labels: ["Askari Saving Unze Trading"] },
  { key: "hbl_pf_unze_trading", labels: ["HBL PF Unze Trading", "HBL PF"] },
  { key: "meezan_bank_unze_trading", labels: ["Meezan Bank Unze Trading", "Meezan Bank"] },
  { key: "hbl_unze_trading", labels: ["HBL Unze Trading"] },
  { key: "hbl_h_unze_trading", labels: ["HBL - H Unze Trading", "HBL-H Unze Trading", "HBL H Unze"] },
  { key: "faysal_bank_unze_trading", labels: ["Faysal Bank Unze Trading", "Faysal Bank"] },
];

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

function detectCurrency(text: string): string {
  if (/£/.test(text)) return "GBP";
  if (/\$/.test(text)) return "USD";
  if (/€/.test(text)) return "EUR";
  return "PKR";
}

export async function parseBankPositionPDF(buffer: Buffer): Promise<BankPositionParsed> {
  const text = await extractTextFromPDF(buffer);

  const banks: Record<string, number> = {};
  for (const bank of BANK_LABELS) {
    for (const label of bank.labels) {
      const val = extractNumber(text, label);
      if (val > 0) {
        banks[bank.key] = val;
        break;
      }
    }
    if (!(bank.key in banks)) {
      banks[bank.key] = 0;
    }
  }

  const totalAvailableBalance =
    extractNumber(text, "Total Available Balance") ||
    extractNumber(text, "Total Balance");

  const postDatedCHQsTotal =
    extractNumber(text, "Post Dated CHQs") ||
    extractNumber(text, "Post-Dated CHQs") ||
    extractNumber(text, "Post Dated Cheques");

  const pdIdx = text.toLowerCase().indexOf("post dated");
  const pdSection = pdIdx >= 0 ? text.slice(pdIdx) : "";
  const postDatedCurrency = pdSection ? detectCurrency(pdSection) : "PKR";

  return {
    date: extractDate(text),
    banks,
    totalAvailableBalance,
    postDatedCHQsTotal,
    postDatedCurrency,
    rawText: text,
  };
}
