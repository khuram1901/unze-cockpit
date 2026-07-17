import * as XLSX from "xlsx";

// Parses Imperial Footwear's (Unze London retail) cumulative P&L workbook —
// the big "PL-CURRENT.xlsx" file the accounts team maintains. Shape
// confirmed against the real file (17/07/2026):
//
//   - One sheet per month named like "July-25", "Aug-25", … "June-26".
//   - Each month sheet: branch blocks of 3 columns (Projection | Actual |
//     Variance) starting at column B, branch names on row 1 ("UNZE LONDON
//     (DHA)" etc). Summary blocks at the end ("Online (Pk)", "Retails",
//     "Total (Pk)") are used for validation only, never stored.
//   - Rows: Gross Sales Before Tax, Tax, Net Sales, Total COGS, Gross
//     Profit, ~32 overhead lines, Total Overheads, Net Operating Profit,
//     then Add:/Less: below-the-line items, ending at Profit/(Loss) After
//     Total Expenses.
//
// The whole workbook is uploaded each month (it's cumulative). Every month
// sheet with real activity is parsed and validated independently — one
// result per month, exactly like the Unze Trading per-file pattern.

export type IfplLine = {
  branch: string;
  channel: string;
  line: string;
  category: "core" | "overhead" | "below_add" | "below_less" | "other";
  projection: number;
  actual: number;
};
// blocking=false checks are data-quality warnings: shown on the page but
// they never reject a month (the source file has historic quirks — e.g.
// Aug-25 Hakim Mall has sales but no COGS row — that accounts won't refile).
export type IfplCheck = { name: string; expected: number; reported: number; diff: number; passed: boolean; blocking: boolean };
export type ParsedIfplMonth = {
  month: string; // YYYY-MM-01
  lines: IfplLine[];
  checks: IfplCheck[];
  accepted: boolean;
  summary: string;
};

// Canonical names for the total/subtotal rows — the file's trailing colons,
// stray full stops and spelling quirks stop here.
const CORE_MAP: Record<string, string> = {
  "Gross Sales Before Tax": "Gross Sales",
  "Cross Sales Before Tax": "Gross Sales", // Aug-25 typo in the real file
  "Tax": "Tax",
  "Net Sales": "Net Sales",
  "Total Cost of Goods Sold": "Total COGS",
  "Gross Profit": "Gross Profit",
  "Total Overheads": "Total Overheads",
  "Net Operating Profit": "Net Operating Profit",
  "Profit/(Loss) After Total Expenses": "Final Profit",
};

// Below-the-line lines get a canonical name AND a canonical sign. The
// file's own "Add:"/"Less:" prefixes are unreliable — Jan-26 onwards says
// "Add: Depriciation" while the maths still subtracts it — so the sign
// comes from what the line IS, never from the prefix.
const BELOW_LINES: { match: RegExp; name: string; category: "below_add" | "below_less" }[] = [
  { match: /deprici|depreci/i, name: "Depreciation & Amortisation", category: "below_less" },
  { match: /headoffice|head office/i, name: "Head Office Allocation", category: "below_less" },
  { match: /minimum/i, name: "Minimum Income Tax", category: "below_less" },
  { match: /stock adjust/i, name: "Stock Adjustments", category: "below_less" },
  { match: /allocation income|income-allocation/i, name: "Other Income-Allocation", category: "below_add" },
  { match: /other income/i, name: "Other Income", category: "below_add" },
];
const SKIP_LINES = new Set([
  "Profit & Loss", "Gross Profit Margin", "Operating Expenses",
]);

const MONTH_SHEET_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*-(\d{2})$/i;
const MONTH_NUM: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function num(v: unknown): number {
  return typeof v === "number" && !Number.isNaN(v) ? v : 0;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
// "Total Cost of Goods Sold :" -> "Total Cost of Goods Sold";
// "Gross Profit." -> "Gross Profit"
function cleanLabel(raw: string): string {
  return raw.replace(/\s*[:.\-]+\s*$/, "").replace(/\s+/g, " ").trim();
}

// Branch name normalisation — strips "UNZE LONDON", parentheses and the
// file's known typos so the same branch always lands under one name.
const BRANCH_FIXES: Record<string, string> = {
  "Head Office Alloaction": "Head Office",
  "Head Office Allocation": "Head Office",
  "Warehouse Alloaction": "Warehouse",
  "Warehouse Allocation": "Warehouse",
  "Libert Store": "Liberty Store",
  "Sailkot Store 1": "Sialkot Store",
  "Phalila Mandi Bahaudin": "Phalia Mandi Bahauddin",
};
function cleanBranch(raw: string): string {
  let b = raw.replace(/UNZE LONDON/gi, "").replace(/[()\n]/g, " ").replace(/\s+/g, " ").trim();
  if (BRANCH_FIXES[b]) b = BRANCH_FIXES[b];
  return b;
}
// Summary blocks at the right edge of each month sheet — validation only,
// never stored. Oct-25 names its online summary "UNZE LONDON Online", so
// after cleaning, a block called exactly "Online" is also a summary (the
// real online branch is always "ONLINE PK").
const SUMMARY_BLOCKS = new Set(["Online Pk", "Retails", "Total Pk", "Online (Pk)", "Retails ", "Total (Pk)", "Online"]);
function channelFor(branch: string): string {
  const b = branch.toLowerCase();
  if (b === "online pk") return "Online PK";
  if (b.includes("head office") || b.includes("warehouse")) return "Cost centre";
  if (b.includes("uk") || b.includes("green street")) return "UK";
  return "Retail";
}

function tol(expected: number): number {
  return Math.max(2000, Math.abs(expected) * 0.001);
}

// Runs in the BROWSER (dynamic import on the Imperial page): the workbook
// is ~9.4 MB and Vercel caps request bodies at 4.5 MB, so the file itself
// can never be posted — the client parses it and sends only the extracted
// rows (~1.5 MB of JSON) to /api/pnl/upload-ifpl.
export function parseIfplPnl(data: ArrayBuffer | Uint8Array): ParsedIfplMonth[] {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });

  // Company-level actual Net Sales per month from the month-wise summary
  // sheet, used as an independent cross-check on each month sheet.
  const monthWise = readMonthWiseNetSales(wb);

  const results: ParsedIfplMonth[] = [];
  for (const sheetName of wb.SheetNames) {
    const m = sheetName.trim().match(MONTH_SHEET_RE);
    if (!m) continue;
    const monthNum = MONTH_NUM[m[1].slice(0, 3).toLowerCase()];
    const year = 2000 + parseInt(m[2], 10);
    const month = `${year}-${String(monthNum).padStart(2, "0")}-01`;
    const parsed = parseMonthSheet(wb, sheetName, month, monthWise[month]);
    if (parsed) results.push(parsed);
  }
  results.sort((a, b) => a.month.localeCompare(b.month));
  return results;
}

function readMonthWiseNetSales(wb: XLSX.WorkBook): Record<string, number> {
  const out: Record<string, number> = {};
  const sheet = wb.Sheets[wb.SheetNames.find((n) => n.trim().startsWith("YTD") && n.includes("Month Wise")) || ""];
  if (!sheet) return out;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });
  const dateRow = rows.find((r) => r && r.some((c) => c instanceof Date));
  const nsRow = rows.find((r) => cleanLabel(str(r?.[0])) === "Net Sales");
  if (!dateRow || !nsRow) return out;
  for (let c = 0; c < dateRow.length; c++) {
    const v = dateRow[c];
    if (v instanceof Date) {
      const month = `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-01`;
      // Layout per month block: Projection | (pct) | Actual — the actual
      // sits two columns right of the header date column.
      out[month] = num(nsRow[c + 2]);
    }
  }
  return out;
}

function parseMonthSheet(wb: XLSX.WorkBook, sheetName: string, month: string, monthWiseNs: number | undefined): ParsedIfplMonth | null {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, raw: true });
  if (rows.length < 10) return null;

  const headerIdx = rows.findIndex((r) => cleanLabel(str(r?.[0])) === "Profit & Loss");
  if (headerIdx < 0) return null;
  // The branch-name row is whichever row above the header mentions the
  // brand — its exact index shifts depending on how blank rows survive.
  const nameRow = rows.slice(0, headerIdx).find((r) => (r || []).some((c) => str(c).toUpperCase().includes("UNZE LONDON"))) || [];

  // Branch blocks: name at col c, Projection c, Actual c+1 in data rows
  // (the name row and data rows share the same first column per block).
  const blocks: { col: number; branch: string }[] = [];
  const summaryCols: { col: number; name: string }[] = [];
  for (let c = 1; c < nameRow.length; c++) {
    const raw = str(nameRow[c]).trim();
    if (!raw) continue;
    const cleaned = cleanBranch(raw);
    if (SUMMARY_BLOCKS.has(raw.trim()) || SUMMARY_BLOCKS.has(cleaned) || cleaned === "Online Pk" || cleaned === "Retails" || cleaned === "Total Pk") {
      summaryCols.push({ col: c, name: cleaned });
    } else if (raw.toUpperCase().includes("UNZE LONDON")) {
      blocks.push({ col: c, branch: cleaned });
    }
  }
  if (blocks.length === 0) return null;

  const lines: IfplLine[] = [];
  let inOverheads = false;
  const totalPk = summaryCols.find((s) => s.name.replace(/[^a-z]/gi, "").toLowerCase() === "totalpk");
  let totalPkNetSalesActual: number | null = null;

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const rawLabel = str(row[0]).trim();
    if (!rawLabel) continue;
    const label = cleanLabel(rawLabel);
    if (SKIP_LINES.has(label) || label.startsWith("Operating Expenses")) {
      if (label.startsWith("Operating Expenses")) inOverheads = true;
      continue;
    }

    let category: IfplLine["category"];
    let canonical: string;
    const belowMatch = /^(Add|Less):/i.test(rawLabel) ? BELOW_LINES.find((b) => b.match.test(rawLabel)) : undefined;
    if (belowMatch) {
      category = belowMatch.category;
      canonical = belowMatch.name;
      inOverheads = false;
    } else if (CORE_MAP[label]) {
      canonical = CORE_MAP[label];
      category = "core";
      if (canonical === "Total Overheads") inOverheads = false;
    } else if (inOverheads) {
      canonical = label;
      category = "overhead";
    } else {
      canonical = label;
      category = "other";
    }

    for (const b of blocks) {
      const projection = num(row[b.col]);
      const actual = num(row[b.col + 1]);
      if (projection === 0 && actual === 0) continue;
      lines.push({ branch: b.branch, channel: channelFor(b.branch), line: canonical, category, projection, actual });
    }
    if (canonical === "Net Sales" && totalPk) totalPkNetSalesActual = num(row[totalPk.col + 1]);
  }

  // A month with no actual sales at all (future months sitting in the
  // workbook as projection-only) is skipped, not rejected.
  const sumLine = (line: string, field: "projection" | "actual") =>
    lines.filter((l) => l.line === line).reduce((s, l) => s + l[field], 0);
  if (sumLine("Net Sales", "actual") === 0) return null;

  // Some months leave the Final Profit cell blank for a few branches (the
  // formula wasn't filled down — Apr-26 has three such branches). The
  // components are all present, so compute the missing final instead of
  // storing a false zero.
  const branchNames = [...new Set(lines.map((l) => l.branch))];
  for (const field of ["projection", "actual"] as const) {
    for (const b of branchNames) {
      const bl = lines.filter((l) => l.branch === b);
      const one = (line: string) => bl.filter((l) => l.line === line).reduce((s, l) => s + l[field], 0);
      const calc = one("Net Operating Profit")
        + bl.filter((l) => l.category === "below_add").reduce((s, l) => s + l[field], 0)
        - bl.filter((l) => l.category === "below_less").reduce((s, l) => s + l[field], 0);
      const finLine = bl.find((l) => l.line === "Final Profit");
      if (Math.abs(calc) > 1000 && (!finLine || finLine[field] === 0)) {
        if (finLine) finLine[field] = calc;
        else lines.push({ branch: b, channel: channelFor(b), line: "Final Profit", category: "core", projection: field === "projection" ? calc : 0, actual: field === "actual" ? calc : 0 });
      }
    }
  }

  const checks: IfplCheck[] = [];
  const addCheck = (name: string, expected: number, reported: number, blocking: boolean) => {
    const diff = reported - expected;
    checks.push({ name, expected, reported, diff, passed: Math.abs(diff) <= tol(expected), blocking });
  };
  for (const field of ["actual", "projection"] as const) {
    const f = field === "actual" ? "actual" : "plan";
    const hard = field === "actual"; // projection-side identities warn only
    addCheck(`Net sales = gross − tax (${f})`, sumLine("Gross Sales", field) - sumLine("Tax", field), sumLine("Net Sales", field), hard);
    addCheck(`Gross profit = net sales − COGS (${f})`, sumLine("Net Sales", field) - sumLine("Total COGS", field), sumLine("Gross Profit", field), false);
    addCheck(`Operating profit = GP − overheads (${f})`, sumLine("Gross Profit", field) - sumLine("Total Overheads", field), sumLine("Net Operating Profit", field), hard);
    addCheck(`Overhead lines sum to total (${f})`, sumLine("Total Overheads", field), lines.filter((l) => l.category === "overhead").reduce((s, l) => s + l[field], 0), false);
    const belowNet = lines.filter((l) => l.category === "below_add").reduce((s, l) => s + l[field], 0)
      - lines.filter((l) => l.category === "below_less").reduce((s, l) => s + l[field], 0);
    addCheck(`Final profit = op profit ± below-the-line (${f})`, sumLine("Net Operating Profit", field) + belowNet, sumLine("Final Profit", field), hard);
  }
  if (totalPkNetSalesActual !== null) {
    addCheck("Branch sum matches file's Total (Pk) column", totalPkNetSalesActual, sumLine("Net Sales", "actual"), true);
  }
  if (monthWiseNs !== undefined && monthWiseNs !== 0) {
    addCheck("Matches the month-wise summary sheet", monthWiseNs, sumLine("Net Sales", "actual"), true);
  }

  const blockingFailed = checks.filter((c) => !c.passed && c.blocking);
  const warnings = checks.filter((c) => !c.passed && !c.blocking);
  const accepted = blockingFailed.length === 0;
  const passedCount = checks.filter((c) => c.passed).length;
  const summary = accepted
    ? `${passedCount}/${checks.length} checks passed${warnings.length ? ` (${warnings.length} data-quality warning${warnings.length > 1 ? "s" : ""})` : ""} · ${blocks.length} branches · net sales ${(sumLine("Net Sales", "actual") / 1e6).toFixed(1)}m`
    : `${blockingFailed.length} blocking check${blockingFailed.length > 1 ? "s" : ""} failed`;

  return { month, lines, checks, accepted, summary };
}
