import * as XLSX from "xlsx";

// Parses Unze Trading's monthly "P & L Branchwise Allocated" export.
// Shape confirmed against a real file (26-05 P & L Branchwise Allocated
// May-26.xlsx): a plant-header row (FEDMIC/MEPCO/PESCO/HO/Total), 8 fixed
// summary lines below it, a "Share Allocation" row above it, then a long
// ledger detail section grouped by Cost of sales / Non-operating income and
// expenditure / Operating costs / Taxation / Turnover, each containing
// several account groups (e.g. "O-61120000 - Admin-Utility") and the
// individual account codes inside each group.
//
// Column positions drift by a cell or two between rows (Excel merged-cell
// export quirk) — values are matched to the nearest plant header by
// midpoint between adjacent header columns, not a fixed column index.

export type PnlLineItem = { plant: string; line: string; amount: number };
export type PnlLedgerLine = { plant: string; accountGroup: string; accountCode: string | null; accountName: string | null; amount: number };
export type PnlAllocationPct = { plant: string; pct: number };
export type PnlCheck = { name: string; expected: number; reported: number; diff: number; passed: boolean };

export type ParsedUnzePnl = {
  month: string;        // YYYY-MM-01
  lineItems: PnlLineItem[];
  ledgerLines: PnlLedgerLine[];
  allocationPct: PnlAllocationPct[];
  checks: PnlCheck[];
  accepted: boolean;
};

// Maps the source file's exact (slightly inconsistent — a typo, uneven
// spacing around some ampersands) row labels to a clean canonical name.
// Everything downstream (the database, the RPCs, the page) only ever sees
// the canonical name on the right — the file's quirks stop here.
const SUMMARY_LINE_MAP: Record<string, string> = {
  " Gross Sale": "Gross Sale",
  " Total Cost of Sale": "Total Cost of Sale",
  " GP": "GP",
  " Operating Expenses-Admin& Selling": "Operating Expenses",
  "Taxation": "Taxation",
  "Net Profit After Tax": "Net Profit After Tax",
  "Non Operationg Income and exp.": "Non Operating Income and Exp",
  "Net Profit After  Non Opr.Income & Exp": "Net Profit Final",
};
const SUMMARY_LINES = Object.keys(SUMMARY_LINE_MAP) as (keyof typeof SUMMARY_LINE_MAP)[];

const SECTION_HEADERS = new Set([
  "Cost of sales",
  "Non-operating income and expenditure",
  "Operating costs",
  "Taxation",
  "Turnover",
]);

const TOL = 5; // rupees — floating point / rounding tolerance for reconciliation checks

function num(v: unknown): number | null {
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

// Given a row and a sorted list of header {label, col}, return one value per
// header. Column positions drift by a cell or two between rows (merged-cell
// export quirk), so rather than a fixed offset this takes every numeric
// cell inside a window around the headers and, when the count matches the
// number of headers exactly, pairs them up in column order — 1st cell to
// 1st header, 2nd to 2nd, etc. That's the shape every row we've checked
// follows (exactly one value per plant/total, no extras in between).
// If the count doesn't match (a stray value slipped into the window), falls
// back to nearest-midpoint bucketing as a best effort.
function valuesByHeader(row: unknown[], headers: { label: string; col: number }[]): Record<string, number> {
  if (headers.length === 0) return {};
  const lo = Math.max(4, headers[0].col - 6);
  const hi = headers[headers.length - 1].col + 5;
  const cells: { col: number; v: number }[] = [];
  for (let c = lo; c <= hi && c < row.length; c++) {
    const v = num(row[c]);
    if (v !== null) cells.push({ col: c, v });
  }

  const out: Record<string, number> = {};
  if (cells.length === headers.length) {
    headers.forEach((h, i) => { out[h.label] = cells[i].v; });
    return out;
  }

  // Fallback: nearest-midpoint bucketing, ties broken toward the right
  // (higher-numbered) header since values sit just left of their header.
  const bounds = headers.map((h, i) => {
    const prevMid = i === 0 ? -Infinity : (headers[i - 1].col + h.col) / 2;
    const nextMid = i === headers.length - 1 ? Infinity : (h.col + headers[i + 1].col) / 2;
    return { ...h, lo: prevMid, hi: nextMid };
  });
  for (const { col, v } of cells) {
    const b = bounds.find((b) => col > b.lo && col <= b.hi);
    if (b) out[b.label] = v;
  }
  return out;
}

export function parseUnzePnl(buffer: Buffer, monthOverride?: string): ParsedUnzePnl {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

  // Locate the plant header row (FEDMIC/MEPCO/PESCO/HO/Total).
  let headerRowIdx = -1;
  let headers: { label: string; col: number }[] = [];
  for (let r = 0; r < Math.min(15, data.length); r++) {
    const row = data[r];
    const found = row
      .map((cell, col) => ({ label: str(cell).trim(), col }))
      .filter((c) => ["FEDMIC", "MEPCO", "PESCO", "HO", "Total"].includes(c.label));
    if (found.length === 5) {
      headerRowIdx = r;
      headers = found.sort((a, b) => a.col - b.col);
      break;
    }
  }
  if (headerRowIdx === -1) {
    throw new Error("Could not find the plant header row (FEDMIC / MEPCO / PESCO / HO / Total). This doesn't look like a Unze Trading branchwise P&L export.");
  }

  // Month, from the Excel serial number in the "From Date:" row. Read as a
  // raw serial (not a JS Date) — converting via cellDates drags in
  // fractional-day rounding that can roll the date back to the wrong month.
  let month = monthOverride || "";
  if (!month) {
    for (let r = 0; r < headerRowIdx && !month; r++) {
      const row = data[r];
      const idx = row.findIndex((c) => str(c).trim() === "From Date:");
      if (idx === -1) continue;
      const serial = row.slice(idx + 1, idx + 8).find((c) => typeof c === "number") as number | undefined;
      if (serial) {
        const d = new Date((serial - 25569) * 86400000);
        month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
      }
    }
  }
  if (!month) throw new Error("Could not find the report month (\"From Date:\") in the file.");

  // Share Allocation row — usually just above the header row.
  const allocationPct: PnlAllocationPct[] = [];
  for (let r = 0; r < headerRowIdx; r++) {
    const row = data[r];
    if (row.some((c) => str(c).trim() === "Share Allocation")) {
      // Bound against the FULL header set (so PESCO's right edge is the
      // Total column, not +Infinity) — then only keep the 3 operating plants.
      const vals = valuesByHeader(row, headers);
      for (const plant of ["FEDMIC", "MEPCO", "PESCO"]) {
        if (vals[plant] !== undefined) allocationPct.push({ plant, pct: vals[plant] });
      }
    }
  }

  // 8 fixed summary lines.
  const lineItems: PnlLineItem[] = [];
  const summaryByLine: Record<string, Record<string, number>> = {};
  let lastSummaryRowIdx = headerRowIdx;
  for (let r = headerRowIdx + 1; r < Math.min(headerRowIdx + 30, data.length); r++) {
    const row = data[r];
    const label = str(row[0]).trim();
    const match = SUMMARY_LINES.find((l) => l.trim() === label);
    if (!match) continue;
    const canonical = SUMMARY_LINE_MAP[match];
    const vals = valuesByHeader(row, headers);
    summaryByLine[canonical] = vals;
    lastSummaryRowIdx = r;
    for (const [plant, amount] of Object.entries(vals)) lineItems.push({ plant, line: canonical, amount });
  }

  // Ledger detail: walk rows after the summary block, tracking section/group.
  const ledgerLines: PnlLedgerLine[] = [];
  let currentGroup = "";
  const detailStart = lastSummaryRowIdx + 1;
  for (let r = detailStart; r < data.length; r++) {
    const row = data[r];
    const colA = str(row[0]).trim();
    const colB = str(row[1]).trim();
    const colD = str(row[3]).trim();

    if (SECTION_HEADERS.has(colA) || colA === "Sub Group Total" || colA === "Group Total") {
      continue;
    }
    if (colA === "" && colB === "" && colD === "") {
      continue; // fully blank spacer row
    }
    const groupMatch = !colB && colA.match(/^[A-Za-z]+-\d+\s*-\s*(.+)$/);
    if (groupMatch) {
      // Account-group header row, e.g. "O-61120000 - Admin-Utility" — the
      // source file isn't fully consistent with spacing around the dash
      // (compare "C-51110000 - Cost of Finished Goods" to the Taxation
      // group's "TAX-81110000- Taxation"), so this allows either.
      currentGroup = groupMatch[1].trim();
      continue;
    }
    if (colB && colD) {
      // Account-code detail row. Bound against the full header set (so HO's
      // right edge is the Total column, not +Infinity), then drop the Total
      // column itself — it's a rollup of the plant columns, not a plant.
      const vals = valuesByHeader(row, headers);
      for (const [plant, amount] of Object.entries(vals)) {
        if (plant === "Total" || amount === 0) continue;
        ledgerLines.push({ plant, accountGroup: currentGroup || "Unclassified", accountCode: colB, accountName: colD, amount });
      }
    }
  }

  // ── Validation checks ──────────────────────────────────────────────
  const checks: PnlCheck[] = [];
  // Confirmed against a real file: this raw monthly export's "Total" column
  // is the sum of the three operating plants ONLY (FEDMIC + MEPCO + PESCO).
  // HO is Head Office overhead shown separately, pre-allocation — it isn't
  // folded into Total here (unlike the finished dashboard's own Total,
  // which is post-allocation). Confirm this reading is correct before
  // relying on it for real uploads.
  const plants = ["FEDMIC", "MEPCO", "PESCO"];

  for (const canonical of Object.values(SUMMARY_LINE_MAP)) {
    const vals = summaryByLine[canonical];
    if (!vals) continue;
    const sum = plants.reduce((s, p) => s + (vals[p] || 0), 0);
    const total = vals["Total"] || 0;
    checks.push({
      name: `Operating plants sum vs file total — ${canonical}`,
      expected: total,
      reported: sum,
      diff: sum - total,
      passed: Math.abs(sum - total) <= TOL,
    });
  }

  const t = (line: string, plant = "Total") => summaryByLine[line]?.[plant] ?? NaN;
  const gpCheck = t("Gross Sale") + t("Total Cost of Sale");
  checks.push({ name: "GP = Gross Sale + Total Cost of Sale", expected: t("GP"), reported: gpCheck, diff: gpCheck - t("GP"), passed: Math.abs(gpCheck - t("GP")) <= TOL });

  const npatCheck = t("GP") + t("Operating Expenses") + t("Taxation");
  checks.push({ name: "NPAT = GP + Operating Expenses + Taxation", expected: t("Net Profit After Tax"), reported: npatCheck, diff: npatCheck - t("Net Profit After Tax"), passed: Math.abs(npatCheck - t("Net Profit After Tax")) <= TOL });

  const finalCheck = t("Net Profit After Tax") + t("Non Operating Income and Exp");
  checks.push({ name: "Final = NPAT + Non-operating", expected: t("Net Profit Final"), reported: finalCheck, diff: finalCheck - t("Net Profit Final"), passed: Math.abs(finalCheck - t("Net Profit Final")) <= TOL });

  const allocSum = allocationPct.reduce((s, a) => s + a.pct, 0);
  checks.push({ name: "Allocation percentages sum to 100%", expected: 100, reported: allocSum, diff: allocSum - 100, passed: Math.abs(allocSum - 100) <= 0.1 });

  // Every ledger line across all five sections (Cost of sales, Non-operating,
  // Operating costs, Taxation, Turnover) rolls up, per plant, to the exact
  // negative of that plant's final line — confirmed against a real file.
  // This is what actually verifies "every cell, every row" rather than just
  // the 8 summary lines: if a single account-code cell were wrong, this
  // catches it even though the summary lines above would still balance.
  for (const plant of ["FEDMIC", "MEPCO", "PESCO", "HO"]) {
    const ledgerSum = ledgerLines.filter((l) => l.plant === plant).reduce((s, l) => s + l.amount, 0);
    const expected = -(t("Net Profit Final", plant) || 0);
    checks.push({
      name: `Ledger detail total vs final profit line — ${plant}`,
      expected,
      reported: ledgerSum,
      diff: ledgerSum - expected,
      passed: Math.abs(ledgerSum - expected) <= TOL,
    });
  }

  const accepted = checks.length > 0 && checks.every((c) => c.passed);

  return { month, lineItems, ledgerLines, allocationPct, checks, accepted };
}
