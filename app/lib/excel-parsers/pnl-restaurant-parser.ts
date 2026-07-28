import * as XLSX from "xlsx";

// Parses the restaurant P&L workbooks (Baranh + Haute Dolci) — one file per
// company, maintained cumulatively by the restaurant accountants. Shape
// confirmed against the real Apr-26 files (28/07/2026):
//
//   - One sheet per branch ("Baranh Gulberg", "Haute Dolce - Raya", …) with
//     month columns (Excel dates on the header row, back to 2021/2022) and
//    ~100 P&L line rows: Gross Sales → Tax/Discount → Net Sales → bank
//    discount claims → Total Sales → stock/COGS block → Gross Profit →
//    admin expense lines → Total Administrative Expenses → Profit after
//    Operations → Less:/Add: below-the-line → Net Profit.
//   - ACTUALS only — no projections in these files.
//   - The files contain sporadic o→m typos ("Purcahses", "Telephmne",
//     "Prmfit", "Sampling Cmst") — canonicalised here so the database only
//     ever sees clean names.
//
// Runs in the BROWSER (dynamic import on the Restaurants page) and posts
// extracted rows as JSON, same as the Imperial pipeline.

export type RestLine = {
  branch: string;
  line: string;
  category: "core" | "bank_discount" | "cogs_detail" | "expense" | "below_less" | "below_add" | "other";
  amount: number;
};
export type RestCheck = { name: string; expected: number; reported: number; diff: number; passed: boolean; blocking: boolean };
export type ParsedRestMonth = {
  month: string; // YYYY-MM-01
  lines: RestLine[];
  checks: RestCheck[];
  accepted: boolean;
  summary: string;
};

export type RestCompany = "BARANH" | "HD";

// Which sheets are branch sheets, and the clean branch name for each.
const COMPANY_CONFIG: Record<RestCompany, { titleMatch: RegExp; sheetToBranch: { match: RegExp; branch: string }[] }> = {
  BARANH: {
    titleMatch: /baranh/i,
    sheetToBranch: [
      { match: /^Baranh Gulberg$/i, branch: "Gulberg" },
      { match: /^Baranh Raya$/i, branch: "Raya" },
      { match: /^Baranh Y-?BLOCK$/i, branch: "Y-Block" },
      { match: /^Baranh PACKAGES$/i, branch: "Packages" },
    ],
  },
  HD: {
    // The legal entity on HD's sheet titles is "Dolce Restaurants Pvt. Ltd"
    titleMatch: /dolc/i,
    sheetToBranch: [
      { match: /^Haute Dolce?i? - Raya\.?$/i, branch: "Raya" },
      { match: /^Haute Dolce?i? - Gulberg\.?$/i, branch: "Gulberg" },
      { match: /^Haute Dolce?i? - Dolme?a?n\.?$/i, branch: "Dolmen" },
      { match: /^Haute Dolce?i? - Y ?Block\.?$/i, branch: "Y-Block" },
      { match: /^Haute Dolce?i? - Packages\.?$/i, branch: "Packages" },
    ],
  },
};

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
// Fix the file's sporadic o→m typos and normalise spacing/punctuation.
function cleanLabel(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/\s*[:.]+\s*$/, "")
    .trim()
    .replace(/\bPurcahses\b/i, "Purchases")
    .replace(/\bDiffernce\b/i, "Difference")
    .replace(/\bPrmfit\b/i, "Profit")
    .replace(/\bTelephmne\b/i, "Telephone")
    .replace(/\bDirectmr\b/i, "Director")
    .replace(/\bCmst\b/i, "Cost")
    .replace(/\bDevelmpment\b/i, "Development")
    .replace(/\bDepriciation\b/i, "Depreciation");
}

const CORE_MAP: Record<string, string> = {
  "Gross Sales": "Gross Sales",
  "Tax": "Tax",
  "Discount": "Discount",
  "Net Sales": "Net Sales",
  "Total Sales": "Total Sales",
  "Total Cost of Goods Sold": "Total Cost of Goods Sold",
  "Gross Profit/ (Loss)": "Gross Profit",
  "Total Administrative Expenses": "Total Administrative Expenses",
  "Profit/ (Loss) after Operations": "Profit after Operations",
  "Net Profit/ (Loss)": "Net Profit",
};
const SKIP = new Set(["", "Gross Profit/ (Loss) %", "Tax & Discount", "Administrative Expenses"]);
const COGS_DETAIL = new Set(["Opening Stock", "Purchases", "Input Disallow", "Closing Stock", "Mtech CGS", "Stock Adjustments", "Wastage", "Staff Food", "Difference"]);
const BANK_DISCOUNT = /discount claim|habib metro|js bank|silk bank|^hbl$|bank islami/i;
const BELOW: { match: RegExp; name: string; category: "below_less" | "below_add" }[] = [
  { match: /allocation-?\s*head\s*office|head\s*office\s*allocation/i, name: "Head Office Allocation", category: "below_less" },
  { match: /warehouse allocation/i, name: "Warehouse Allocation", category: "below_less" },
  { match: /minimum/i, name: "Minimum Income Tax", category: "below_less" },
  { match: /depreciation/i, name: "Depreciation", category: "below_less" },
  { match: /input disallow/i, name: "Input Disallow (below line)", category: "below_less" },
  { match: /other income/i, name: "Other Income", category: "below_add" },
];

function tol(expected: number): number {
  return Math.max(2000, Math.abs(expected) * 0.005);
}

export function parseRestaurantPnl(data: ArrayBuffer | Uint8Array, company: RestCompany): ParsedRestMonth[] {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });
  const config = COMPANY_CONFIG[company];

  // Wrong-file guard: the branch-sheet titles must mention this company.
  const branchSheets: { sheet: string; branch: string }[] = [];
  for (const name of wb.SheetNames) {
    const hit = config.sheetToBranch.find((s) => s.match.test(name.trim()));
    if (hit) branchSheets.push({ sheet: name, branch: hit.branch });
  }
  if (branchSheets.length === 0) {
    const otherKey = company === "BARANH" ? "HD" : "BARANH";
    const looksLikeOther = wb.SheetNames.some((n) => COMPANY_CONFIG[otherKey].sheetToBranch.some((s) => s.match.test(n.trim())));
    throw new Error(looksLikeOther
      ? "This looks like the OTHER company's file — check you're on the right tab."
      : "No branch sheets found — is this the right workbook?");
  }

  // Collect per-branch month series first, then pivot to per-month results.
  type BranchData = { branch: string; months: string[]; byMonth: Map<string, RestLine[]> };
  const branches: BranchData[] = [];
  const allMonths = new Set<string>();

  for (const { sheet, branch } of branchSheets) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, raw: true });
    if (rows.length < 10) continue;
    const title = cleanLabel(str(rows.find((r) => str(r?.[0]).trim())?.[0] || ""));
    if (!config.titleMatch.test(title)) {
      throw new Error(`Sheet "${sheet}" doesn't look like a ${company === "BARANH" ? "Baranh" : "Haute Dolci"} branch sheet.`);
    }
    // ≥1 date, not ≥3: a newly opened branch (Baranh Packages, Apr-26) has
    // a single month column. Only configured branch sheets reach this code,
    // so the loose threshold can't misfire on other sheets.
    const headerIdx = rows.findIndex((r) => (r || []).filter((c) => c instanceof Date).length >= 1);
    if (headerIdx < 0) continue;
    const hdr = rows[headerIdx] || [];
    const monthCols: { col: number; month: string }[] = [];
    for (let c = 0; c < hdr.length; c++) {
      const v = hdr[c];
      if (v instanceof Date) {
        // The cells are month-start dates entered in Pakistan time; SheetJS
        // shifts them into the local timezone, which can land the previous
        // evening (2026-04-01 → 2026-03-31T19:00Z). Nudge by 12 hours and
        // read in UTC so the month is right whatever computer parses it.
        const d = new Date(v.getTime() + 12 * 3600 * 1000);
        monthCols.push({ col: c, month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01` });
      }
    }

    const byMonth = new Map<string, RestLine[]>();
    for (const { month } of monthCols) byMonth.set(month, []);

    // Position flags, because the labels drift between branches ("Discount"
    // vs "Discounts", "ABL Discount Claim" vs "Add:ABL Discount"): anything
    // between Net Sales and Total Sales is a bank discount claim, and a
    // Discount(s) row before Net Sales is the sales discount — the admin
    // expense also called "Discounts" comes later, inside the expense block.
    let inExpenses = false;
    let inBankClaims = false;
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const label = cleanLabel(str(row[0]));
      if (SKIP.has(label) || /^Profit & Loss/i.test(label)) continue;
      if (label === "Administrative Expenses") { inExpenses = true; continue; }

      let canonical = label;
      let category: RestLine["category"];
      const below = /^(Less|Add):/i.test(label) || /^Depreciation$/i.test(label) ? BELOW.find((b) => b.match.test(label)) : undefined;
      if (below && !inBankClaims) {
        canonical = below.name;
        category = below.category;
        inExpenses = false;
      } else if ((label === "Discount" || label === "Discounts") && !inExpenses && !inBankClaims) {
        canonical = "Discount";
        category = "core";
      } else if (CORE_MAP[label]) {
        canonical = CORE_MAP[label];
        category = "core";
        if (canonical === "Net Sales") inBankClaims = true;
        if (canonical === "Total Sales") inBankClaims = false;
        if (canonical === "Total Administrative Expenses") inExpenses = false;
        if (canonical === "Gross Profit") inExpenses = false;
      } else if (inBankClaims) {
        canonical = label.replace(/^add:?\s*/i, "").replace(/\s*discount( claim(ed)?)?$/i, "").trim() || label;
        category = "bank_discount";
      } else if (COGS_DETAIL.has(label)) {
        category = "cogs_detail";
      } else if (BANK_DISCOUNT.test(label)) {
        canonical = label.replace(/ discount claim(ed)?/i, "");
        category = "bank_discount";
      } else if (inExpenses) {
        category = "expense";
      } else {
        category = "other";
      }

      for (const { col, month } of monthCols) {
        let amount = num(row[col]);
        if (amount === 0) continue;
        // The files store costs as NEGATIVES (COGS −8m, admin −7.7m, every
        // "Less:" item negative). Normalise so the database holds positive
        // cost magnitudes like the other P&L pipelines — the identities
        // then read naturally (GP = sales − COGS, NP = op − less + add).
        if (category === "expense" || category === "below_less"
          || canonical === "Total Cost of Goods Sold" || canonical === "Total Administrative Expenses") {
          amount = -amount;
        }
        if (canonical === "Tax" || canonical === "Discount") amount = Math.abs(amount);
        byMonth.get(month)!.push({ branch, line: canonical, category, amount });
      }
      // The expenses section starts right after Gross Profit % in these
      // files; entering it is detected by the header row handled above.
      if (canonical === "Gross Profit") inExpenses = true;
    }
    branches.push({ branch, months: monthCols.map((m) => m.month), byMonth });
    for (const m of monthCols) allMonths.add(m.month);
  }

  const results: ParsedRestMonth[] = [];
  for (const month of [...allMonths].sort()) {
    const lines: RestLine[] = [];
    for (const b of branches) {
      const ml = b.byMonth.get(month);
      if (ml) lines.push(...ml);
    }
    const sum = (line: string) => lines.filter((l) => l.line === line).reduce((s, l) => s + l.amount, 0);
    const sumCat = (cat: RestLine["category"]) => lines.filter((l) => l.category === cat).reduce((s, l) => s + l.amount, 0);
    if (sum("Net Sales") === 0) continue; // pre-opening / empty months

    const checks: RestCheck[] = [];
    const addCheck = (name: string, expected: number, reported: number, blocking: boolean) => {
      const diff = reported - expected;
      checks.push({ name, expected, reported, diff, passed: Math.abs(diff) <= tol(expected), blocking });
    };
    // Warning-tier, not blocking: Apr/May 2023 in the real Baranh file are
    // internally off by 0.5-0.75m on this identity (historic quirk the
    // accountants won't refile) — shown amber in the data-quality panel.
    addCheck("Net sales = gross − tax − discount", sum("Gross Sales") - sum("Tax") - sum("Discount"), sum("Net Sales"), false);
    addCheck("Total sales = net sales + bank discount claims", sum("Net Sales") + sumCat("bank_discount"), sum("Total Sales"), false);
    addCheck("Operating profit = GP − admin expenses", sum("Gross Profit") - sum("Total Administrative Expenses"), sum("Profit after Operations"), true);
    addCheck("Expense lines sum to total admin", sum("Total Administrative Expenses"), sumCat("expense"), false);
    const belowNet = sumCat("below_add") - sumCat("below_less");
    addCheck("Net profit = op profit ± below-the-line", sum("Profit after Operations") + belowNet, sum("Net Profit"), true);
    addCheck("Gross profit = total sales − COGS", sum("Total Sales") - sum("Total Cost of Goods Sold"), sum("Gross Profit"), false);

    const blockingFailed = checks.filter((c) => !c.passed && c.blocking);
    const warnings = checks.filter((c) => !c.passed && !c.blocking);
    const accepted = blockingFailed.length === 0;
    const passedCount = checks.filter((c) => c.passed).length;
    const summary = accepted
      ? `${passedCount}/${checks.length} checks passed${warnings.length ? ` (${warnings.length} warning${warnings.length > 1 ? "s" : ""})` : ""} · ${branches.length} branches · net sales ${(sum("Net Sales") / 1e6).toFixed(1)}m`
      : `${blockingFailed.length} blocking check${blockingFailed.length > 1 ? "s" : ""} failed`;

    results.push({ month, lines, checks, accepted, summary });
  }
  return results;
}
