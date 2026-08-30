import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { UTPL_COMPANY_ID } from "../../../lib/constants";
import { financeCompanies, type UserCtx, type PermOverrides } from "../../../lib/permissions";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const BALANCE_TOLERANCE_PCT = 0.01; // 0.01% — hard check
// Expected owner capital for UTPL (₨60M). Soft check — warn if it changes.
const EXPECTED_OWNER_CAPITAL = 60_000_000;

// ── Types ────────────────────────────────────────────────────────────────────
type BsCheck = {
  name: string;
  expected: number;
  reported: number;
  diff: number;
  passed: boolean;
  note?: string;
};
type BsParsed = {
  // 17 raw line items
  ppe: number;
  long_term_investment: number;
  receivables: number;
  stocks: number;
  advances_prepayments: number;
  advance_taxation: number;
  cash_bank: number;
  owner_capital: number;
  revenue_reserves: number;
  retained_earnings: number;
  hbl_stf: number;
  loan_family: number;
  mazhar_sb_ac: number;
  loan_associates: number;
  lease_liabilities: number;
  accrued_liabilities: number;
  payable_controls: number;
  taxation: number;
  // Reported subtotals from file (may be 0 if not found)
  r_total_fixed: number;
  r_total_current: number;
  r_total_assets: number;
  r_total_equity: number;
  r_total_ncl: number;
  r_total_cl: number;
  r_total_eq_liab: number;
};

// ── Field matchers ───────────────────────────────────────────────────────────
// Built against the real "BS  (R)" sheet in Unze's monthly workbooks
// (verified Feb–Jun 2026). `exact` = label must equal (after lowercasing and
// space-collapsing); `contains` = substring match. Exact wins first so plain
// "Taxation" can't collide with "Advance Taxation", and "Total Equity" (which
// in this workbook is the GRAND total, equity + liabilities) can't swallow
// "Owner's Equity" (the actual equity subtotal).
type FieldMatcher = { exact?: string[]; contains?: string[] };
const FIELD_MATCHERS: [keyof BsParsed, FieldMatcher][] = [
  ["ppe",                  { contains: ["property, plant", "property plant", "ppe"] }],
  ["long_term_investment", { contains: ["long term invest", "long-term invest"] }],
  ["receivables",          { contains: ["investment, deposit", "receivable", "debtors"] }],
  ["stocks",               { contains: ["stocks", "inventories", "raw material"] }],
  ["advances_prepayments", { contains: ["advance & prepay", "advances & prepay", "advance and prepay", "prepayment"] }],
  ["advance_taxation",     { contains: ["advance taxation", "advance tax"] }],
  ["cash_bank",            { contains: ["cash at bank", "cash & bank", "cash and bank", "cash in hand", "bank balance"] }],
  ["owner_capital",        { contains: ["owner capital", "owner's capital", "paid-up capital", "paid up capital", "share capital"] }],
  ["revenue_reserves",     { contains: ["revenue reserve", "general reserve", "capital reserve"] }],
  // Source file writes "Retain Earning Account" — match the stem.
  ["retained_earnings",    { contains: ["retain earning", "retained earning", "accumulated profit", "accumulated loss", "profit & loss account", "profit and loss account"] }],
  // Short-term bank facility slot: "HBL Short term Facility (STF)" from
  // Jun-26 onward; "Faysal Bank - Overdraft Morahba Facility" in earlier
  // months. Same balance-sheet slot (note 10) → same DB column.
  ["hbl_stf",              { contains: ["hbl", "short term facility", "stf", "overdraft", "faysal", "morahba", "running finance"] }],
  ["loan_family",          { contains: ["loan from family", "family loan", "directors loan", "director's loan"] }],
  ["mazhar_sb_ac",         { contains: ["mazhar"] }],
  ["loan_associates",      { contains: ["loan from associate", "associates loan", "related party loan"] }],
  ["lease_liabilities",    { contains: ["lease liabilit", "right-of-use", "finance lease"] }],
  // Source file spells it "Accrued Libilities" — match "accrued" alone.
  ["accrued_liabilities",  { contains: ["accrued", "accruals"] }],
  ["payable_controls",     { contains: ["payable control", "trade and other payable", "creditors", "trade payable"] }],
  ["taxation",             { exact: ["taxation"], contains: ["taxation payable", "income tax payable", "tax payable", "provision for tax"] }],
  // Reported totals as this workbook labels them:
  //   "Total Assets"   → total assets
  //   "Owner's Equity" → equity subtotal
  //   "Total Equity"   → grand total (equity + liabilities) — quirk of this format
  ["r_total_fixed",        { exact: ["total fixed assets", "total non-current assets"] }],
  ["r_total_current",      { exact: ["total current assets"] }],
  ["r_total_assets",       { exact: ["total assets"] }],
  ["r_total_equity",       { exact: ["owner's equity", "owners equity", "total owner's equity"] }],
  ["r_total_ncl",          { exact: ["total non-current liabilities", "total long term liabilities"] }],
  ["r_total_cl",           { exact: ["total current liabilities"] }],
  ["r_total_eq_liab",      { exact: ["total equity", "total equity & liabilities", "total equity and liabilities", "total capital & liabilities"] }],
];

// Normally non-zero fields — flag these if they come back 0
const NORMALLY_NONZERO: (keyof BsParsed)[] = [
  "ppe", "receivables", "stocks", "advance_taxation", "cash_bank",
  "owner_capital", "revenue_reserves", "retained_earnings",
  "accrued_liabilities", "payable_controls", "taxation",
];

// ── Month auto-detection ─────────────────────────────────────────────────────
// Priority: ① the BS sheet's own title row ("AS AT FEBRUARY 28, 2026") — the
// most reliable source; ② the filename; ③ other sheet names (last resort —
// these workbooks carry stale tabs like "Mar-26" in every month's file).
// Filename handles "Jun-26", "Jun26", "June 2026", "February 28 26"
// (day-then-year — the LAST number is the year), and ISO "2026-06".
const MONTH_SHORT: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
const MONTH_RE = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

function detectMonth(filename: string, wb: XLSX.WorkBook, bsRows: unknown[][] | null): string | null {
  // ① Sheet title: "AS AT <MONTH> <DAY>, <YEAR>"
  if (bsRows) {
    for (const row of bsRows.slice(0, 8)) {
      for (const cell of row) {
        const s = String(cell ?? "").toLowerCase();
        const m = s.match(new RegExp(`as\\s+at\\s+(${MONTH_RE})\\s+(\\d{1,2})[,\\s]+(\\d{4})`));
        if (m) {
          const mn = MONTH_SHORT[m[1].slice(0, 3)];
          if (mn) return `${m[3]}-${mn}-01`;
        }
      }
    }
  }
  // ② Filename, then ③ sheet names
  const sources = [filename, ...wb.SheetNames];
  for (const src of sources) {
    const s = src.toLowerCase();
    // Named month followed by 1–2 numbers. Two numbers ("February 28 26")
    // means day-then-year — the LAST number is the year.
    const named = s.match(new RegExp(`\\b(${MONTH_RE})[- _]?(\\d{1,4})(?:[- _,]+(\\d{2,4}))?\\b`));
    if (named) {
      const mn = MONTH_SHORT[named[1].slice(0, 3)];
      // If the number right after the month is already a valid 4-digit year
      // ("Jan 2026 12.xlsx" — trailing "12" is a version, not the year),
      // keep it; only treat the second number as the year for the
      // day-then-year shape ("February 28 26").
      const g2 = named[2];
      let yr = (g2.length === 4 && +g2 >= 2000 && +g2 <= 2099) ? g2 : (named[3] || g2);
      if (yr.length === 1) continue; // single digit — ambiguous, keep looking
      if (yr.length === 2) yr = `20${yr}`;
      if (mn && yr.length === 4 && +yr >= 2000 && +yr <= 2099) return `${yr}-${mn}-01`;
    }
    // ISO-ish: "2026-06" or "2026/06"
    const iso = s.match(/\b(20\d{2})[- /](\d{2})\b/);
    if (iso && +iso[2] >= 1 && +iso[2] <= 12) return `${iso[1]}-${iso[2]}-01`;
  }
  return null;
}

function findBsSheet(wb: XLSX.WorkBook): { sheet: XLSX.WorkSheet; name: string } | null {
  // Sheet is named "BS  (R)" (two spaces) in the real files — collapse
  // whitespace before matching.
  const preferred = wb.SheetNames.find((n) =>
    /bs\s*\(\s*r\s*\)/i.test(n.replace(/\s+/g, " ")) || /^bs[\s_-]?r$/i.test(n.trim())
  );
  if (preferred) return { sheet: wb.Sheets[preferred], name: preferred };
  const fallback = wb.SheetNames.find((n) => /\bbs\b/i.test(n));
  if (fallback) return { sheet: wb.Sheets[fallback], name: fallback };
  return null;
}

// The current-month value column: the sheet has paired columns (current month
// then prior year), each headed "Rupees" with a "%" beside it. The FIRST
// "Rupees" header is the current month. Falls back to column D.
function findValueCol(rows: unknown[][]): number {
  for (const row of rows.slice(0, 10)) {
    for (let c = 0; c < row.length; c++) {
      if (String(row[c] ?? "").trim().toLowerCase() === "rupees") return c;
    }
  }
  return 3;
}

function parseSheet(wb: XLSX.WorkBook): { parsed: BsParsed; sheetUsed: string; rows: unknown[][] } | { error: string } {
  const found = findBsSheet(wb);
  if (!found) {
    return { error: `No Balance Sheet sheet found. Available sheets: ${wb.SheetNames.join(", ")}. Expecting a sheet named "BS (R)" or similar.` };
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(found.sheet, { header: 1, defval: null, raw: true });
  const valueCol = findValueCol(rows);
  const parsed = {} as BsParsed;
  for (const [field] of FIELD_MATCHERS) (parsed as Record<string, number>)[field] = 0;

  const matchedRows = new Set<number>();
  for (const [field, m] of FIELD_MATCHERS) {
    for (let r = 0; r < rows.length; r++) {
      if (matchedRows.has(r)) continue;
      const row = rows[r];
      const label = String(row[1] ?? row[0] ?? "").toLowerCase().replace(/\s+/g, " ").trim();
      if (!label) continue;
      const isExact = (m.exact || []).some((k) => label === k);
      const isContains = !isExact && (m.contains || []).some((k) => label.includes(k));
      if (!isExact && !isContains) continue;
      const v = row[valueCol];
      if (typeof v === "number" && !Number.isNaN(v)) {
        (parsed as Record<string, number>)[field] = v;
        matchedRows.add(r);
        break;
      }
    }
  }
  return { parsed, sheetUsed: found.name, rows };
}

// ── Note sheet parser ────────────────────────────────────────────────────────
// The workbook's " BS Note" sheet carries the account-level breakdown behind
// each balance-sheet note (1–17): individual accounts, bank balances, tax
// lines, etc. Parsed into balance_sheet_notes so the app can show the data
// behind every note number. Best-effort: a missing/odd note sheet never
// blocks the upload.
type BsNoteLine = {
  note_no: number; section: string | null; account_code: string | null;
  account_name: string; amount: number | null; is_total: boolean;
  is_header: boolean; row_order: number;
};

function parseNoteSheet(wb: XLSX.WorkBook): BsNoteLine[] {
  const sheetName = wb.SheetNames.find((n) => /bs\s*note/i.test(n));
  if (!sheetName) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: null, raw: true });
  const s = (v: unknown) => (v == null ? "" : String(v).trim());

  // Current-month value column: header cell "TOTAL" or "Rupees"; fallback D.
  let valueCol = 3;
  outer:
  for (const row of rows.slice(0, 10)) {
    for (let c = 2; c < Math.min(row.length, 10); c++) {
      const h = s(row[c]).toLowerCase();
      if (h === "total" || h === "rupees") { valueCol = c; break outer; }
    }
  }

  const lines: BsNoteLine[] = [];
  let curNote: number | null = null;
  let curSection: string | null = null;
  let order = 0;

  for (const row of rows) {
    const code = s(row[0]);
    const label = s(row[1]);
    const noteCell = s(row[2]);
    const v = row[valueCol];
    const val = typeof v === "number" && !Number.isNaN(v) ? v : null;

    // Numbered section header, incl. sub-notes like "1.2", "8.1", "1.2.A"
    const noteMatch = noteCell.match(/^(\d{1,2})(?:\.\d+)*(?:\.?[A-Za-z])?$/);
    if (label && noteMatch) {
      const n = parseInt(noteMatch[1], 10);
      if (n >= 1 && n <= 17) {
        curNote = n;
        curSection = label;
        lines.push({ note_no: n, section: label, account_code: code || null, account_name: label, amount: val, is_total: false, is_header: true, row_order: order++ });
        continue;
      }
    }
    if (curNote === null) continue;

    // Unnumbered rollups / ALL-CAPS section rows end the current note.
    const ROLLUP = /^(total\s|non current liabilit|current liabilit|inter company payable|assets$|liabilities$|capital\s*&)/i;
    const isAllCaps = label.length > 3 && label === label.toUpperCase() && /[A-Z]/.test(label);
    if (label && !code && !noteMatch && (ROLLUP.test(label) || isAllCaps)) { curNote = null; curSection = null; continue; }
    if (label.startsWith("*")) continue; // annotation

    if ((code || label) && val !== null) {
      lines.push({ note_no: curNote, section: curSection, account_code: code || null, account_name: label || code, amount: val, is_total: false, is_header: false, row_order: order++ });
      continue;
    }
    if (!code && !label && val !== null) {
      lines.push({ note_no: curNote, section: curSection, account_code: null, account_name: "Total", amount: val, is_total: true, is_header: false, row_order: order++ });
      continue;
    }
    // Label-only row with no value inside a note — keep as a zero line.
    if (label && !code && val === null) {
      lines.push({ note_no: curNote, section: curSection, account_code: null, account_name: label, amount: 0, is_total: false, is_header: false, row_order: order++ });
    }
  }
  return lines;
}

// ── Audit checks ─────────────────────────────────────────────────────────────
function runChecks(p: BsParsed, totalAssets: number): BsCheck[] {
  const checks: BsCheck[] = [];

  const totalFixed   = p.ppe + p.long_term_investment;
  const totalCurrent = p.receivables + p.stocks + p.advances_prepayments + p.advance_taxation + p.cash_bank;
  const computedAssets = totalFixed + totalCurrent;
  const totalEquity  = p.owner_capital + p.revenue_reserves + p.retained_earnings;
  const totalNcl     = p.hbl_stf + p.loan_family + p.mazhar_sb_ac + p.loan_associates + p.lease_liabilities;
  const totalCl      = p.accrued_liabilities + p.payable_controls + p.taxation;
  const equityPlusLiab = totalEquity + totalNcl + totalCl;
  const fmt = (n: number) => `₨${Math.round(Math.abs(n)).toLocaleString("en", { maximumFractionDigits: 0 })}`;

  // ── 1. Fundamental equation: Assets = Equity + Liabilities (HARD — rejects if fails) ──
  const bsDiff = Math.abs(computedAssets - equityPlusLiab);
  const bsTol  = totalAssets > 0 ? (bsDiff / Math.abs(computedAssets)) * 100 : 100;
  checks.push({
    name: "Balance Sheet equation (Assets = Equity + Liabilities)",
    expected: computedAssets,
    reported: equityPlusLiab,
    diff: bsDiff,
    passed: bsTol < BALANCE_TOLERANCE_PCT,
    note: bsTol >= BALANCE_TOLERANCE_PCT ? `Out of balance by ${fmt(bsDiff)} (${bsTol.toFixed(3)}%)` : undefined,
  });

  // ── 2–4. Subtotals vs file-reported totals (soft — warn if file has them) ──
  if (p.r_total_fixed > 0) {
    const diff = Math.abs(totalFixed - p.r_total_fixed);
    checks.push({ name: "Fixed Assets subtotal matches file", expected: p.r_total_fixed, reported: totalFixed, diff, passed: diff < 100 });
  }
  if (p.r_total_current > 0) {
    const diff = Math.abs(totalCurrent - p.r_total_current);
    checks.push({ name: "Current Assets subtotal matches file", expected: p.r_total_current, reported: totalCurrent, diff, passed: diff < 100 });
  }
  if (p.r_total_assets > 0) {
    const diff = Math.abs(computedAssets - p.r_total_assets);
    checks.push({ name: "Total Assets matches file", expected: p.r_total_assets, reported: computedAssets, diff, passed: diff < 100 });
  }
  if (p.r_total_equity > 0) {
    const diff = Math.abs(totalEquity - p.r_total_equity);
    checks.push({ name: "Total Equity subtotal matches file", expected: p.r_total_equity, reported: totalEquity, diff, passed: diff < 100 });
  }
  if (p.r_total_ncl > 0) {
    const diff = Math.abs(totalNcl - p.r_total_ncl);
    checks.push({ name: "Non-Current Liabilities subtotal matches file", expected: p.r_total_ncl, reported: totalNcl, diff, passed: diff < 100 });
  }
  if (p.r_total_cl > 0) {
    const diff = Math.abs(totalCl - p.r_total_cl);
    checks.push({ name: "Current Liabilities subtotal matches file", expected: p.r_total_cl, reported: totalCl, diff, passed: diff < 100 });
  }
  if (p.r_total_eq_liab > 0) {
    const diff = Math.abs(equityPlusLiab - p.r_total_eq_liab);
    checks.push({ name: "Total Equity & Liabilities matches file", expected: p.r_total_eq_liab, reported: equityPlusLiab, diff, passed: diff < 100 });
  }

  // ── 5. Equity >= Paid-up capital (no capital erosion) ──
  checks.push({
    name: "Accumulated equity >= paid-up capital (no capital erosion)",
    expected: p.owner_capital,
    reported: totalEquity,
    diff: totalEquity - p.owner_capital,
    passed: totalEquity >= p.owner_capital,
    note: totalEquity < p.owner_capital ? "Total equity is below paid-up capital — retained losses may have eroded reserves." : undefined,
  });

  // ── 6. PPE non-negative ──
  checks.push({
    name: "PPE is non-negative (net book value cannot be negative)",
    expected: 0,
    reported: p.ppe,
    diff: p.ppe,
    passed: p.ppe >= 0,
    note: p.ppe < 0 ? `PPE shows ${fmt(p.ppe)} — check accumulated depreciation against cost in source file.` : undefined,
  });

  // ── 7. Individual current asset components are non-negative ──
  const nonNegAssets: [string, number][] = [
    ["Receivables", p.receivables],
    ["Stocks", p.stocks],
    ["Advance & Prepayments", p.advances_prepayments],
    ["Advance Taxation", p.advance_taxation],
    ["Cash & Bank", p.cash_bank],
  ];
  for (const [label, val] of nonNegAssets) {
    if (val < 0) {
      checks.push({
        name: `${label} is non-negative`,
        expected: 0,
        reported: val,
        diff: val,
        passed: false,
        note: `${label} shows ${fmt(val)} — asset balances should not be negative. Check source file.`,
      });
    }
  }

  // ── 8. Owner capital matches expected value for UTPL ──
  const ocDiff = Math.abs(p.owner_capital - EXPECTED_OWNER_CAPITAL);
  if (ocDiff > 1000) {
    checks.push({
      name: `Owner Capital matches expected ₨${(EXPECTED_OWNER_CAPITAL / 1_000_000).toFixed(0)}M (paid-up capital should be stable)`,
      expected: EXPECTED_OWNER_CAPITAL,
      reported: p.owner_capital,
      diff: p.owner_capital - EXPECTED_OWNER_CAPITAL,
      passed: false,
      note: `Owner Capital is ${fmt(p.owner_capital)}, expected ${fmt(EXPECTED_OWNER_CAPITAL)}. Share capital changes require board resolution — verify.`,
    });
  }

  return checks;
}

function auditWarnings(p: BsParsed, prior: Record<string, number> | null, totalAssets: number): string[] {
  const warnings: string[] = [];
  const fmtPKR = (n: number) => `₨${Math.round(Math.abs(n)).toLocaleString("en", { maximumFractionDigits: 0 })}`;

  // Zero values that should never be zero
  for (const field of NORMALLY_NONZERO) {
    const v = (p as Record<string, number>)[field];
    if (v === 0) {
      warnings.push(`"${field.replace(/_/g, " ")}" parsed as zero — possible missed row or label mismatch in the sheet.`);
    }
  }

  // PPE negative (caught by hard check, also surfaced as warning for clarity)
  if (p.ppe < 0) warnings.push(`PPE is ${fmtPKR(p.ppe)} negative — verify cost vs accumulated depreciation in source file.`);

  // Large swing in total assets from prior month
  if (prior && prior.total_assets > 0) {
    const swing = Math.abs(totalAssets - prior.total_assets) / prior.total_assets;
    if (swing > 0.4) {
      warnings.push(`Total Assets changed by ${(swing * 100).toFixed(1)}% vs prior month (${fmtPKR(prior.total_assets)} → ${fmtPKR(totalAssets)}). Verify this is correct.`);
    }
  }

  // Retained earnings regression without context
  if (prior && prior.retained_earnings > 0 && p.retained_earnings < prior.retained_earnings) {
    const drop = prior.retained_earnings - p.retained_earnings;
    warnings.push(`Retained Earnings fell by ${fmtPKR(drop)} vs prior month. Confirm this is supported by P&L for the period.`);
  }

  // Cash swing > 50%
  if (prior && prior.cash_bank > 0) {
    const swing = Math.abs(p.cash_bank - prior.cash_bank) / prior.cash_bank;
    if (swing > 0.5) {
      warnings.push(`Cash & Bank changed by ${(swing * 100).toFixed(1)}% vs prior month (${fmtPKR(prior.cash_bank)} → ${fmtPKR(p.cash_bank)}) — verify.`);
    }
  }

  // Stock spike > 100% (could be data-entry error)
  if (prior && prior.stocks > 0) {
    const swing = (p.stocks - prior.stocks) / prior.stocks;
    if (swing > 1.0) {
      warnings.push(`Stocks more than doubled vs prior month (${fmtPKR(prior.stocks)} → ${fmtPKR(p.stocks)}). Confirm correct.`);
    }
  }

  // Negative retained earnings (accumulated losses) — notable but not an error
  if (p.retained_earnings < 0) {
    warnings.push(`Retained Earnings is negative (${fmtPKR(p.retained_earnings)}) — the business has accumulated losses exceeding reserves. Monitor closely.`);
  }

  // HBL STF very high relative to total assets (>40%)
  if (totalAssets > 0 && p.hbl_stf > 0 && p.hbl_stf / totalAssets > 0.4) {
    warnings.push(`HBL Short Term Facility is ${((p.hbl_stf / totalAssets) * 100).toFixed(1)}% of total assets (${fmtPKR(p.hbl_stf)}) — high reliance on bank borrowing.`);
  }

  // Working capital negative (current liabilities exceed current assets)
  const totalCurrent = p.receivables + p.stocks + p.advances_prepayments + p.advance_taxation + p.cash_bank;
  const totalCl = p.accrued_liabilities + p.payable_controls + p.taxation;
  if (totalCurrent > 0 && totalCl > totalCurrent) {
    warnings.push(`Working Capital is negative — current liabilities (${fmtPKR(totalCl)}) exceed current assets (${fmtPKR(totalCurrent)}). Short-term liquidity risk.`);
  }

  return warnings;
}

// ── Main handler ─────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();

  // Resolve permissions
  const { data: member } = await supabase
    .from("members")
    .select("id, role, department, company")
    .eq("email", auth.email)
    .maybeSingle();
  let overrides: PermOverrides | null = null;
  if (member?.id) {
    const { data: perms } = await supabase.from("member_permissions").select("*").eq("member_id", member.id).maybeSingle();
    overrides = (perms as PermOverrides) || null;
  }
  const ctx: UserCtx = { email: auth.email, role: member?.role ?? null, department: member?.department ?? null, company: member?.company ?? null, overrides };
  const scope = financeCompanies(ctx);
  if (scope !== "both" && scope !== "UTPL") {
    return NextResponse.json({ error: "Not authorised to upload Unze Trading's Balance Sheet." }, { status: 403 });
  }

  // Parse FormData
  let file: File | null = null;
  try {
    const formData = await request.formData();
    file = formData.get("file") as File | null;
  } catch {
    return NextResponse.json({ error: "Could not read the uploaded file." }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "An Excel file is required." }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "File exceeds 10 MB limit." }, { status: 413 });

  // ── Parse xlsx ────────────────────────────────────────────────────────────
  let parsed: BsParsed, sheetUsed: string, month: string;
  let noteLines: BsNoteLine[] = [];
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });

    const result = parseSheet(wb);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 422 });
    parsed = result.parsed;
    sheetUsed = result.sheetUsed;

    // Auto-detect month: BS sheet title ("AS AT ...") first, then filename,
    // then sheet names.
    const detected = detectMonth(file.name, wb, result.rows);
    if (!detected) {
      return NextResponse.json({
        error: `Could not detect the month from the sheet title, the filename "${file.name}", or sheet names. ` +
          `Rename the file to include the month, e.g. "Balance Sheet Jun-26.xlsx", and re-upload.`,
      }, { status: 422 });
    }
    month = detected;

    // Account-level note breakdown (best-effort — never blocks the upload)
    try { noteLines = parseNoteSheet(wb); } catch { noteLines = []; }
  } catch (e) {
    return NextResponse.json({ error: "Could not read this file: " + (e instanceof Error ? e.message : String(e)) }, { status: 400 });
  }

  // Computed totals
  const totalFixed   = parsed.ppe + parsed.long_term_investment;
  const totalCurrent = parsed.receivables + parsed.stocks + parsed.advances_prepayments + parsed.advance_taxation + parsed.cash_bank;
  const totalAssets  = totalFixed + totalCurrent;

  // ── Load prior month data for comparison ─────────────────────────────────
  const { data: priorRows } = await supabase
    .from("balance_sheet")
    .select("ppe, long_term_investment, receivables, stocks, advances_prepayments, advance_taxation, cash_bank, retained_earnings")
    .eq("company_id", UTPL_COMPANY_ID)
    .lt("month", month)
    .order("month", { ascending: false })
    .limit(1);
  const prior = priorRows && priorRows[0] ? {
    total_assets: (priorRows[0].ppe ?? 0) + (priorRows[0].long_term_investment ?? 0) +
      (priorRows[0].receivables ?? 0) + (priorRows[0].stocks ?? 0) +
      (priorRows[0].advances_prepayments ?? 0) + (priorRows[0].advance_taxation ?? 0) +
      (priorRows[0].cash_bank ?? 0),
    retained_earnings: Number(priorRows[0].retained_earnings ?? 0),
    cash_bank: Number(priorRows[0].cash_bank ?? 0),
    stocks: Number(priorRows[0].stocks ?? 0),
  } : null;

  // ── Run audit checks ──────────────────────────────────────────────────────
  const checks = runChecks(parsed, totalAssets);
  const warnings = auditWarnings(parsed, prior, totalAssets);
  const hardFailed = checks.filter((c) => !c.passed && c.name.includes("equation"));
  const accepted = hardFailed.length === 0;

  // ── Restatement detection ─────────────────────────────────────────────────
  const restated: { field: string; old_value: number; new_value: number }[] = [];
  const { data: existingRows } = await supabase
    .from("balance_sheet")
    .select("ppe, long_term_investment, receivables, stocks, advances_prepayments, advance_taxation, cash_bank, owner_capital, revenue_reserves, retained_earnings, hbl_stf, loan_family, mazhar_sb_ac, loan_associates, lease_liabilities, accrued_liabilities, payable_controls, taxation")
    .eq("company_id", UTPL_COMPANY_ID)
    .eq("month", month)
    .limit(1);
  const existing = existingRows?.[0] as Record<string, number | null> | undefined;
  if (existing && accepted) {
    const LINE_FIELDS: (keyof BsParsed)[] = [
      "ppe","long_term_investment","receivables","stocks","advances_prepayments",
      "advance_taxation","cash_bank","owner_capital","revenue_reserves","retained_earnings",
      "hbl_stf","loan_family","mazhar_sb_ac","loan_associates","lease_liabilities",
      "accrued_liabilities","payable_controls","taxation",
    ];
    for (const field of LINE_FIELDS) {
      const oldVal = Number(existing[field] ?? 0);
      const newVal = parsed[field];
      if (Math.abs(newVal - oldVal) > 1000) {
        restated.push({ field: field.replace(/_/g, " "), old_value: oldVal, new_value: newVal });
      }
    }
  }

  // ── Reject if BS doesn't balance ─────────────────────────────────────────
  if (!accepted) {
    const totalEquity  = parsed.owner_capital + parsed.revenue_reserves + parsed.retained_earnings;
    const totalNcl     = parsed.hbl_stf + parsed.loan_family + parsed.mazhar_sb_ac + parsed.loan_associates + parsed.lease_liabilities;
    const totalCl      = parsed.accrued_liabilities + parsed.payable_controls + parsed.taxation;
    const imbalance    = Math.abs(totalAssets - (totalEquity + totalNcl + totalCl));
    return NextResponse.json({
      accepted: false,
      month,
      sheetUsed,
      checks,
      auditWarnings: warnings,
      summary: `Rejected — Balance Sheet does not balance. Difference: ₨${Math.round(imbalance).toLocaleString("en", { maximumFractionDigits: 0 })}. Fix the source file and re-upload.`,
    }, { status: 422 });
  }

  // ── Save to database ──────────────────────────────────────────────────────
  const lineItems = {
    ppe: parsed.ppe, long_term_investment: parsed.long_term_investment,
    receivables: parsed.receivables, stocks: parsed.stocks,
    advances_prepayments: parsed.advances_prepayments, advance_taxation: parsed.advance_taxation,
    cash_bank: parsed.cash_bank, owner_capital: parsed.owner_capital,
    revenue_reserves: parsed.revenue_reserves, retained_earnings: parsed.retained_earnings,
    hbl_stf: parsed.hbl_stf, loan_family: parsed.loan_family,
    mazhar_sb_ac: parsed.mazhar_sb_ac, loan_associates: parsed.loan_associates,
    lease_liabilities: parsed.lease_liabilities, accrued_liabilities: parsed.accrued_liabilities,
    payable_controls: parsed.payable_controls, taxation: parsed.taxation,
  };

  const { error: dbErr } = await supabase.from("balance_sheet").upsert(
    {
      company_id: UTPL_COMPANY_ID,
      month,
      ...lineItems,
      uploaded_by: auth.email,
      checks_passed: checks.filter((c) => c.passed).length,
      checks_failed: checks.filter((c) => !c.passed).length,
      audit_warnings: warnings,
    },
    { onConflict: "company_id,month" }
  );

  if (dbErr) {
    // Retry without the audit columns ONLY when the error is a missing
    // column (42703 / "column ... does not exist") — any other error must
    // surface rather than silently stripping the audit trail.
    const missingCol = dbErr.code === "42703" || /column .* does not exist/i.test(dbErr.message || "");
    if (!missingCol) return NextResponse.json({ error: dbErr.message }, { status: 500 });
    const { error: dbErr2 } = await supabase.from("balance_sheet").upsert(
      { company_id: UTPL_COMPANY_ID, month, ...lineItems, uploaded_by: auth.email },
      { onConflict: "company_id,month" }
    );
    if (dbErr2) return NextResponse.json({ error: dbErr2.message }, { status: 500 });
    warnings.push("Audit columns (checks_passed / audit_warnings) are missing from the balance_sheet table — figures saved, audit trail not stored. Run migration 183.");
  }

  // ── Save account-level note lines (best-effort, but never silently) ──────
  let notesSaved = 0;
  if (noteLines.length > 0) {
    const { error: delErr } = await supabase
      .from("balance_sheet_notes")
      .delete()
      .eq("company_id", UTPL_COMPANY_ID)
      .eq("month", month);
    if (delErr) {
      warnings.push(`Note breakdowns could not be refreshed (${delErr.message}) — the note panel may show stale data for this month.`);
    } else {
      const { error: notesErr } = await supabase.from("balance_sheet_notes").insert(
        noteLines.map((l) => ({ company_id: UTPL_COMPANY_ID, month, ...l }))
      );
      if (notesErr) {
        warnings.push(`Note breakdowns failed to save (${notesErr.message}) — the note panel will show no detail for this month until a successful re-upload.`);
      } else {
        notesSaved = noteLines.length;
      }
    }
  }

  const checksFailed = checks.filter((c) => !c.passed);

  return NextResponse.json({
    accepted: true,
    month,
    sheetUsed,
    checks,
    auditWarnings: warnings,
    restated: restated.length > 0 ? restated : undefined,
    parsed: lineItems,
    notesSaved,
    summary: checksFailed.length > 0
      ? `Saved — ${checks.length - checksFailed.length}/${checks.length} checks passed (${checksFailed.length} issue${checksFailed.length > 1 ? "s" : ""} to review below).`
      : warnings.length > 0
      ? `All ${checks.length} checks passed — ${warnings.length} audit warning${warnings.length > 1 ? "s" : ""} to review.`
      : `All ${checks.length} checks passed. Balance Sheet balances correctly.`,
  });
}
