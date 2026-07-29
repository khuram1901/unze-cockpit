import * as XLSX from "xlsx";

export type ForecastRow = {
  category: string;
  flowType: "inflow" | "outflow";
  months: { month: string; amount: number }[];
};

// Calculation checks (added 29/07/2026, Khuram's request): the file's own
// TOTAL / NET / CLOSING rows are re-computed from the category lines and
// compared. Blocking failures reject the upload — an internally
// inconsistent forecast never reaches the dashboard. Blank summary rows
// (template zeros) warn instead of failing.
export type ForecastCheck = { name: string; expected: number; reported: number; diff: number; passed: boolean; blocking: boolean };

export type ParsedForecast = {
  rows: ForecastRow[];
  months: string[];
  sheetName: string;
  checks: ForecastCheck[];
  accepted: boolean;
};

function excelDateToMonth(serial: number): string {
  const date = new Date((serial - 25569) * 86400000);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

const SKIP_LABELS = new Set([
  "PROJECTED CASH FLOW:",
  "CASH INFLOW",
  "CASH OUTFLOW",
  "OPENING BALANCE",
  "",
]);

export function parseCashFlowForecast(buffer: Buffer): ParsedForecast {
  const wb = XLSX.read(buffer, { type: "buffer" });

  // Prefer "Monthly-CF" sheet, fall back to first sheet
  const sheetName = wb.SheetNames.includes("Monthly-CF")
    ? "Monthly-CF"
    : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const data: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  // Find the header row with month serial numbers
  let monthColumns: { colIdx: number; month: string }[] = [];
  let headerRowIdx = -1;

  for (let i = 0; i < Math.min(5, data.length); i++) {
    const row = data[i];
    const serials = row
      .map((cell, idx) => ({ cell, idx }))
      .filter(({ cell }) => typeof cell === "number" && cell > 40000 && cell < 60000);

    // >= 1, not >= 2 (fixed 29/07/2026): the finance team legitimately
    // uploads a single-month forecast — Sania's Jul-26 file had exactly one
    // month column and was rejected with "could not find month headers".
    if (serials.length >= 1) {
      headerRowIdx = i;
      monthColumns = serials.map(({ cell, idx }) => ({
        colIdx: idx,
        month: excelDateToMonth(cell as number),
      }));
      break;
    }
  }

  if (monthColumns.length === 0) {
    throw new Error("Could not find month headers in the Excel. Expected Excel serial date numbers in the header row.");
  }

  const months = monthColumns.map((m) => m.month);
  const rows: ForecastRow[] = [];
  // The file's own summary rows, captured per month for the checks.
  const summary: Record<string, number[]> = { opening: [], totalIn: [], totalOut: [], net: [], closing: [] };
  const grab = (row: unknown[]) => monthColumns.map(({ colIdx }) => (typeof row[colIdx] === "number" ? row[colIdx] as number : 0));
  let currentFlowType: "inflow" | "outflow" = "inflow";
  // Section headings ("Pole Project", "Meter Project") group the outflow
  // lines below them — added 18/07/2026 when the template gained per-project
  // sections. The heading becomes a prefix so "Vendor Payments" under Pole
  // Project and under Meter Project stay separate categories instead of
  // overwriting each other. A blank row or a new CASH INFLOW/OUTFLOW marker
  // ends the section (the template has blank rows between sections).
  let currentSection: string | null = null;

  for (let i = headerRowIdx + 1; i < data.length; i++) {
    const row = data[i];
    const label = String(row[0] || "").trim();

    if (!label) { currentSection = null; continue; }

    // Flow markers must be handled BEFORE the skip list — "CASH OUTFLOW"
    // sits in SKIP_LABELS, so the old order skipped the marker row without
    // ever switching to outflow, and every category parsed as an inflow
    // (long-standing bug, found 18/07/2026 while adding sections).
    if (label.toUpperCase().includes("CASH OUTFLOW")) {
      currentFlowType = "outflow";
      currentSection = null;
      continue;
    }
    if (label.toUpperCase().includes("CASH INFLOW")) {
      currentFlowType = "inflow";
      currentSection = null;
      continue;
    }
    const upper = label.toUpperCase();
    if (upper.startsWith("OPENING")) { summary.opening = grab(row); continue; }
    if (SKIP_LABELS.has(label)) continue;
    if (/project\s*$/i.test(label)) {
      currentSection = label;
      continue;
    }

    // The file's summary rows are captured for validation, never stored as
    // categories (NET CASH FLOW was slipping through and being stored as an
    // outflow — found 29/07/2026 testing Sania's file).
    if (upper.startsWith("TOTAL INFLOW")) { summary.totalIn = grab(row); continue; }
    if (upper.startsWith("TOTAL OUTFLOW")) { summary.totalOut = grab(row); continue; }
    if (upper.startsWith("NET CASH")) { summary.net = grab(row); continue; }
    if (upper.startsWith("CLOSING")) { summary.closing = grab(row); continue; }
    if (upper.startsWith("TOTAL")) continue;

    const monthAmounts = monthColumns.map(({ colIdx, month }) => ({
      month,
      amount: typeof row[colIdx] === "number" ? row[colIdx] as number : 0,
    }));

    // Only include if at least one month has a non-zero amount
    if (monthAmounts.some((m) => m.amount !== 0)) {
      rows.push({
        category: currentSection ? `${currentSection} — ${label}` : label,
        flowType: currentFlowType,
        months: monthAmounts,
      });
    }
  }

  // ── Calculation checks per month ─────────────────────────────────
  const checks: ForecastCheck[] = [];
  const TOL = 1; // rupee — these are the file's own formulas, no drift allowed
  const label = (i: number) => {
    const [y, m] = months[i].split("-");
    return new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
  };
  const addCheck = (name: string, expected: number, reported: number, blocking: boolean) => {
    const diff = reported - expected;
    checks.push({ name, expected, reported, diff, passed: Math.abs(diff) <= TOL, blocking });
  };
  for (let i = 0; i < months.length; i++) {
    const sumIn = rows.filter((r) => r.flowType === "inflow").reduce((s, r) => s + r.months[i].amount, 0);
    const sumOut = rows.filter((r) => r.flowType === "outflow").reduce((s, r) => s + r.months[i].amount, 0);
    if (sumIn === 0 && sumOut === 0) continue; // untouched template month
    const fileIn = summary.totalIn[i] || 0;
    const fileOut = summary.totalOut[i] || 0;
    const fileNet = summary.net[i] || 0;
    const opening = summary.opening[i] || 0;
    const fileClosing = summary.closing[i] || 0;
    // Blank summary rows warn ("formula not filled in"); filled ones must
    // agree with the sum of their parts or the upload is rejected.
    if (fileIn !== 0 || sumIn === 0) addCheck(`${label(i)}: total inflow = sum of inflow lines`, sumIn, fileIn, true);
    else addCheck(`${label(i)}: TOTAL INFLOW row is blank — fill the formula`, sumIn, fileIn, false);
    if (fileOut !== 0 || sumOut === 0) addCheck(`${label(i)}: total outflow = sum of outflow lines`, sumOut, fileOut, true);
    else addCheck(`${label(i)}: TOTAL OUTFLOW row is blank — fill the formula`, sumOut, fileOut, false);
    if (fileNet !== 0) addCheck(`${label(i)}: net cash flow = inflow − outflow`, sumIn - sumOut, fileNet, true);
    if (fileClosing !== 0 || opening !== 0) addCheck(`${label(i)}: closing = opening + net cash flow`, opening + (sumIn - sumOut), fileClosing, fileClosing !== 0);
    // Month chaining: this month's closing should be next month's opening.
    if (i < months.length - 1 && fileClosing !== 0 && (summary.opening[i + 1] || 0) !== 0) {
      addCheck(`${label(i)} closing should equal ${label(i + 1)} opening`, fileClosing, summary.opening[i + 1] || 0, false);
    }
  }
  const accepted = checks.every((c) => c.passed || !c.blocking);

  return { rows, months, sheetName, checks, accepted };
}
