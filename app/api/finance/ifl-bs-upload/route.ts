import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { IFPL_COMPANY_ID } from "../../../lib/constants";
import { financeCompanies, type UserCtx, type PermOverrides } from "../../../lib/permissions";

// Imperial Footwear Balance Sheet upload.
// Built against the June-2026 workbook format: a face "BS" sheet (section
// headers in column A, line labels in column B, one value column per fiscal
// year) plus a "Notes" sheet with numbered breakdowns. The month is detected
// from the filename; the value column is the one whose year header matches
// the detected month's (fiscal) year, falling back to the rightmost year.

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const BALANCE_TOLERANCE_PCT = 0.01; // hard check

type BsCheck = { name: string; expected: number; reported: number; diff: number; passed: boolean; note?: string };

const FIELDS = [
  "partner_waqas", "partner_remon", "partner_samira", "retained_earnings",
  "lt_payable_khurram", "lt_provident_fund",
  "trade_creditors", "security_deposits", "charity_uk", "payable_related_parties",
  "intercompany_payables", "other_payables", "accrued_expenses",
  "fixed_assets", "receivables_kamran", "long_term_investments", "provident_fund_asset",
  "stock", "intercompany_receivables", "receivables_directors", "trade_debtors",
  "supplier_deposits", "prepayments", "employee_loans", "advance_income_tax", "cash_bank",
] as const;
type IflParsed = Record<(typeof FIELDS)[number], number>;

type Section = "equity" | "lt_liab" | "st_liab" | "lt_assets" | "cur_assets";
// [field, contains-keywords, section] — section-aware so "Provident Fund"
// on the liability side and the asset side land in different columns.
const FACE: [keyof IflParsed, string[], Section][] = [
  ["partner_waqas",           ["waqas saleem"],                  "equity"],
  ["partner_remon",           ["remon ahmed"],                   "equity"],
  ["partner_samira",          ["samira waqas"],                  "equity"],
  ["retained_earnings",       ["accumulated profit"],            "equity"],
  ["lt_payable_khurram",      ["khurram saleem"],                "lt_liab"],
  ["lt_provident_fund",       ["provident fund"],                "lt_liab"],
  ["trade_creditors",         ["trade creditors"],               "st_liab"],
  ["security_deposits",       ["security deposits"],             "st_liab"],
  ["charity_uk",              ["charity"],                       "st_liab"],
  ["payable_related_parties", ["payable to related"],            "st_liab"],
  ["intercompany_payables",   ["intercompany balance"],          "st_liab"],
  ["other_payables",          ["other payables"],                "st_liab"],
  ["accrued_expenses",        ["accrued expense"],               "st_liab"],
  ["fixed_assets",            ["fixed assets"],                  "lt_assets"],
  ["receivables_kamran",      ["kamran saleem"],                 "lt_assets"],
  ["long_term_investments",   ["investments on baranh", "investment"], "lt_assets"],
  ["provident_fund_asset",    ["provident fund"],                "lt_assets"],
  ["stock",                   ["stock"],                         "cur_assets"],
  ["intercompany_receivables",["intercompany receivable"],       "cur_assets"],
  ["receivables_directors",   ["receivables from director"],     "cur_assets"],
  ["trade_debtors",           ["trade debtors"],                 "cur_assets"],
  ["supplier_deposits",       ["supplier deposit"],              "cur_assets"],
  ["prepayments",             ["prepayment"],                    "cur_assets"],
  ["employee_loans",          ["employee loan"],                 "cur_assets"],
  ["advance_income_tax",      ["advance income tax"],            "cur_assets"],
  ["cash_bank",               ["cash & bank", "cash and bank"],  "cur_assets"],
];

const s = (v: unknown) => (v == null ? "" : String(v).trim());

// ── Month detection (filename) ───────────────────────────────────────────────
const MONTH_SHORT: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
const MONTH_RE = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

function detectMonth(filename: string): string | null {
  const f = filename.toLowerCase();
  const named = f.match(new RegExp(`(${MONTH_RE})[- _]?(\\d{1,4})(?:[- _,]+(\\d{2,4}))?`));
  if (named) {
    const mn = MONTH_SHORT[named[1].slice(0, 3)];
    // If the number right after the month is already a valid 4-digit year,
    // keep it — a trailing "12"/"02" is a version suffix ("Jan 2026 2.xlsx"),
    // not the year. The second number only wins for the day-then-year shape
    // ("June 30 26").
    const g2 = named[2];
    let yr = (g2 && g2.length === 4 && +g2 >= 2000 && +g2 <= 2099) ? g2 : (named[3] || g2);
    if (yr && yr.length === 2) yr = `20${yr}`;
    if (mn && yr && yr.length === 4 && +yr >= 2000 && +yr <= 2099) return `${yr}-${mn}-01`;
  }
  const iso = f.match(/\b(20\d{2})[- /](\d{2})\b/);
  if (iso && +iso[2] >= 1 && +iso[2] <= 12) return `${iso[1]}-${iso[2]}-01`;
  return null;
}

// ── Value-column detection ───────────────────────────────────────────────────
// The face sheet's first rows carry fiscal-year numbers (2025, 2026, …) as
// column headers. Pick the column matching targetYear; else the max year.
function findYearCol(rows: unknown[][], targetYear: number): number | null {
  for (const row of rows.slice(0, 5)) {
    const years: { col: number; yr: number }[] = [];
    row.forEach((c, col) => {
      if (typeof c === "number" && c >= 2000 && c <= 2099) years.push({ col, yr: c });
    });
    if (years.length > 0) {
      const exact = years.find((y) => y.yr === targetYear);
      if (exact) return exact.col;
      return years.sort((a, b) => b.yr - a.yr)[0].col;
    }
  }
  return null;
}

// ── Face parser ──────────────────────────────────────────────────────────────
function parseFace(rows: unknown[][], valueCol: number): { parsed: IflParsed; subtotals: number[] } {
  let section: Section | null = null;
  const parsed = {} as IflParsed;
  for (const [f] of FACE) parsed[f] = 0;
  const subtotals: number[] = [];

  for (const row of rows) {
    const a = s(row[0]).toLowerCase();
    const b = s(row[1]).toLowerCase();
    if (a) {
      if (a === "equity" || a.includes("related party invest") || a.includes("retain")) section = "equity";
      else if (a === "liabilities" || a.includes("long term liab")) section = "lt_liab";
      else if (a.includes("short term")) section = "st_liab";
      else if (a === "assets" || a.includes("long term asset")) section = "lt_assets";
      else if (a.includes("current asset")) section = "cur_assets";
      continue;
    }
    const v = row[valueCol];
    const val = typeof v === "number" && !Number.isNaN(v) ? v : null;
    if (!b && val !== null) { subtotals.push(val); continue; }
    if (b && val !== null && section) {
      for (const [field, keys, sec] of FACE) {
        if (sec !== section || parsed[field] !== 0) continue;
        if (keys.some((k) => b.includes(k))) { parsed[field] = val; break; }
      }
    }
  }
  return { parsed, subtotals };
}

// ── Notes parser ─────────────────────────────────────────────────────────────
// Numbered notes 1–5 in column A; later unnumbered ALL-CAPS sections continue
// the numbering (6 Prepayments, 7 Employee Loans, 8 Cash & Bank incl. credit
// cards, 9 Advance Income Tax).
type NoteLine = {
  note_no: number; section: string | null; account_code: string | null;
  account_name: string; amount: number | null; is_total: boolean;
  is_header: boolean; row_order: number;
};
const UNNUMBERED: [RegExp, number][] = [
  [/^prepayments/i, 6],
  [/^employee loans/i, 7],
  [/^cash & bank/i, 8],
  [/^credit cards/i, 8],
  [/^advance income tax/i, 9],
];

function parseNotes(rows: unknown[][], valueCol: number): NoteLine[] {
  const lines: NoteLine[] = [];
  let curNote: number | null = null;
  let curSection: string | null = null;
  let order = 0;
  for (const row of rows) {
    const a = s(row[0]);
    const b = s(row[1]);
    const v = row[valueCol];
    const val = typeof v === "number" && !Number.isNaN(v) ? v : null;

    const numbered = a.match(/^(\d{1,2})$/);
    if (numbered && b) {
      curNote = parseInt(numbered[1], 10);
      curSection = b;
      lines.push({ note_no: curNote, section: b, account_code: null, account_name: b, amount: val, is_total: false, is_header: true, row_order: order++ });
      continue;
    }
    if (b) {
      const un = UNNUMBERED.find(([re]) => re.test(b));
      if (un) {
        curNote = un[1]; curSection = b;
        lines.push({ note_no: curNote, section: b, account_code: null, account_name: b, amount: val, is_total: false, is_header: true, row_order: order++ });
        continue;
      }
    }
    if (curNote === null) continue;
    if (b.toLowerCase().startsWith("note")) continue; // annotation rows
    if (b && val !== null) {
      lines.push({ note_no: curNote, section: curSection, account_code: null, account_name: b, amount: val, is_total: /^total/i.test(b), is_header: false, row_order: order++ });
      continue;
    }
    if (!b && val !== null) {
      lines.push({ note_no: curNote, section: curSection, account_code: null, account_name: "Total", amount: val, is_total: true, is_header: false, row_order: order++ });
      continue;
    }
    if (b && val === null) {
      lines.push({ note_no: curNote, section: curSection, account_code: null, account_name: b, amount: 0, is_total: false, is_header: false, row_order: order++ });
    }
  }
  return lines;
}

// ── Totals ───────────────────────────────────────────────────────────────────
function totals(p: IflParsed) {
  const totalEquity = p.partner_waqas + p.partner_remon + p.partner_samira + p.retained_earnings;
  const totalLtLiab = p.lt_payable_khurram + p.lt_provident_fund;
  const totalStLiab = p.trade_creditors + p.security_deposits + p.charity_uk + p.payable_related_parties + p.intercompany_payables + p.other_payables + p.accrued_expenses;
  const totalLtAssets = p.fixed_assets + p.receivables_kamran + p.long_term_investments + p.provident_fund_asset;
  const totalCurAssets = p.stock + p.intercompany_receivables + p.receivables_directors + p.trade_debtors + p.supplier_deposits + p.prepayments + p.employee_loans + p.advance_income_tax + p.cash_bank;
  return {
    totalEquity, totalLtLiab, totalStLiab, totalLtAssets, totalCurAssets,
    totalAssets: totalLtAssets + totalCurAssets,
    totalEqLiab: totalEquity + totalLtLiab + totalStLiab,
  };
}

const fmt = (n: number) => `₨${Math.round(Math.abs(n)).toLocaleString("en", { maximumFractionDigits: 0 })}`;

function runChecks(p: IflParsed, subtotals: number[]): BsCheck[] {
  const t = totals(p);
  const checks: BsCheck[] = [];

  // 1. HARD: Assets = Equity + Liabilities
  const diff = Math.abs(t.totalAssets - t.totalEqLiab);
  const pct = t.totalAssets > 0 ? (diff / t.totalAssets) * 100 : 100;
  checks.push({
    name: "Balance Sheet equation (Assets = Equity + Liabilities)",
    expected: t.totalAssets, reported: t.totalEqLiab, diff,
    passed: pct < BALANCE_TOLERANCE_PCT,
    note: pct >= BALANCE_TOLERANCE_PCT ? `Out of balance by ${fmt(diff)} (${pct.toFixed(3)}%)` : undefined,
  });

  // 2. Soft: computed subtotals vs the sheet's own unlabeled subtotal rows.
  // Sequence in this format: equity-partners, LT liab, ST liab, eq+liab
  // total, LT assets, current assets, assets total (plus a residual row).
  const sheetSubs = subtotals.filter((v) => Math.abs(v) > 100_000);
  const expectedSeq: [string, number][] = [
    ["Partner investments subtotal matches file", t.totalEquity - p.retained_earnings],
    ["Long-term liabilities subtotal matches file", t.totalLtLiab],
    ["Short-term liabilities subtotal matches file", t.totalStLiab],
    ["Total Equity & Liabilities matches file", t.totalEqLiab],
    ["Long-term assets subtotal matches file", t.totalLtAssets],
    ["Current assets subtotal matches file", t.totalCurAssets],
    ["Total Assets matches file", t.totalAssets],
  ];
  if (sheetSubs.length === expectedSeq.length) {
    expectedSeq.forEach(([name, computed], i) => {
      const fileVal = sheetSubs[i];
      const d = Math.abs(computed - fileVal);
      checks.push({ name, expected: fileVal, reported: computed, diff: d, passed: d < 100 });
    });
  } else {
    // Positional pairing would mis-align — instead of pairing wrong values
    // (spurious failures) or skipping silently, try to verify the two grand
    // totals by finding them anywhere in the subtotal list, and say what
    // happened.
    const findClose = (v: number) => sheetSubs.some((sv) => Math.abs(sv - v) < 100);
    checks.push({
      name: "Total Assets appears in the file's subtotals",
      expected: t.totalAssets, reported: t.totalAssets, diff: 0,
      passed: findClose(t.totalAssets),
      note: findClose(t.totalAssets) ? undefined : `Computed Total Assets ${fmt(t.totalAssets)} not found among the sheet's subtotal rows — check for missed or extra line items.`,
    });
    checks.push({
      name: "Total Equity & Liabilities appears in the file's subtotals",
      expected: t.totalEqLiab, reported: t.totalEqLiab, diff: 0,
      passed: findClose(t.totalEqLiab),
      note: findClose(t.totalEqLiab) ? undefined : `Computed Total Equity & Liabilities ${fmt(t.totalEqLiab)} not found among the sheet's subtotal rows.`,
    });
    checks.push({
      name: `Subtotal layout matches expected format (found ${sheetSubs.length} subtotal rows, expected ${expectedSeq.length})`,
      expected: expectedSeq.length, reported: sheetSubs.length, diff: sheetSubs.length - expectedSeq.length,
      passed: true, // advisory — the hard balance-equation check still governs acceptance
      note: "The sheet's unlabeled subtotal rows don't match the expected layout, so line-by-line subtotal reconciliation was replaced by grand-total lookups.",
    });
  }

  // 3. Key balances non-negative
  const nonNeg: [string, number][] = [
    ["Stock", p.stock], ["Cash & Bank", p.cash_bank], ["Trade Debtors", p.trade_debtors],
    ["Fixed Assets", p.fixed_assets], ["Prepayments", p.prepayments],
  ];
  for (const [label, val] of nonNeg) {
    if (val < 0) {
      checks.push({ name: `${label} is non-negative`, expected: 0, reported: val, diff: val, passed: false, note: `${label} shows ${fmt(val)} negative — check source file.` });
    }
  }
  return checks;
}

function auditWarnings(p: IflParsed, prior: Record<string, number> | null): string[] {
  const t = totals(p);
  const w: string[] = [];
  const zeroCheck: [string, number][] = [
    ["stock", p.stock], ["trade creditors", p.trade_creditors], ["cash & bank", p.cash_bank],
    ["retained earnings", p.retained_earnings], ["fixed assets", p.fixed_assets],
  ];
  for (const [label, val] of zeroCheck) {
    if (val === 0) w.push(`"${label}" parsed as zero — possible missed row or label change in the sheet.`);
  }
  if (t.totalAssets > 0 && p.stock / t.totalAssets > 0.6) {
    w.push(`Stock is ${((p.stock / t.totalAssets) * 100).toFixed(0)}% of total assets (${fmt(p.stock)}) — heavy inventory concentration; monitor turnover and obsolescence.`);
  }
  if (t.totalStLiab > 0 && p.trade_creditors / t.totalStLiab > 0.7) {
    w.push(`Trade creditors are ${((p.trade_creditors / t.totalStLiab) * 100).toFixed(0)}% of short-term liabilities (${fmt(p.trade_creditors)}) — growth financed largely by supplier credit.`);
  }
  if (t.totalCurAssets > 0 && t.totalStLiab > t.totalCurAssets) {
    w.push(`Working capital is negative — short-term liabilities (${fmt(t.totalStLiab)}) exceed current assets (${fmt(t.totalCurAssets)}).`);
  }
  if (prior) {
    if (prior.total_assets > 0) {
      const swing = Math.abs(t.totalAssets - prior.total_assets) / prior.total_assets;
      if (swing > 0.4) w.push(`Total Assets changed by ${(swing * 100).toFixed(1)}% vs prior period (${fmt(prior.total_assets)} → ${fmt(t.totalAssets)}). Verify.`);
    }
    if (prior.cash_bank > 0) {
      const swing = Math.abs(p.cash_bank - prior.cash_bank) / prior.cash_bank;
      if (swing > 0.5) w.push(`Cash & Bank changed by ${(swing * 100).toFixed(1)}% vs prior period (${fmt(prior.cash_bank)} → ${fmt(p.cash_bank)}) — verify.`);
    }
    if (prior.retained_earnings > 0 && p.retained_earnings < prior.retained_earnings) {
      w.push(`Retained Earnings fell by ${fmt(prior.retained_earnings - p.retained_earnings)} vs prior period. Confirm this is supported by P&L.`);
    }
  }
  return w;
}

// ── Main handler ─────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { data: member } = await supabase
    .from("members").select("id, role, department, company").eq("email", auth.email).maybeSingle();
  let overrides: PermOverrides | null = null;
  if (member?.id) {
    const { data: perms } = await supabase.from("member_permissions").select("*").eq("member_id", member.id).maybeSingle();
    overrides = (perms as PermOverrides) || null;
  }
  const ctx: UserCtx = { email: auth.email, role: member?.role ?? null, department: member?.department ?? null, company: member?.company ?? null, overrides };
  const scope = financeCompanies(ctx);
  if (scope !== "both" && scope !== "IFPL") {
    return NextResponse.json({ error: "Not authorised to upload Imperial Footwear's Balance Sheet." }, { status: 403 });
  }

  let file: File | null = null;
  try {
    const formData = await request.formData();
    file = formData.get("file") as File | null;
  } catch {
    return NextResponse.json({ error: "Could not read the uploaded file." }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "An Excel file is required." }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "File exceeds 10 MB limit." }, { status: 413 });

  let parsed: IflParsed, subtotals: number[], month: string, sheetUsed: string;
  let noteLines: NoteLine[] = [];
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });

    const bsSheetName = wb.SheetNames.find((n) => n.trim().toLowerCase() === "bs")
      || wb.SheetNames.find((n) => /\bbs\b/i.test(n) && !/sap/i.test(n));
    if (!bsSheetName) {
      return NextResponse.json({ error: `No "BS" sheet found. Available sheets: ${wb.SheetNames.join(", ")}.` }, { status: 422 });
    }
    sheetUsed = bsSheetName;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[bsSheetName], { header: 1, defval: null, raw: true });

    const detected = detectMonth(file.name);
    if (!detected) {
      return NextResponse.json({
        error: `Could not detect the month from the filename "${file.name}". Rename it to include the month, e.g. "Balance Sheet June 2026.xlsx", and re-upload.`,
      }, { status: 422 });
    }
    month = detected;

    // The workbook's column headers are FISCAL year labels (Pakistan FY runs
    // July–June, so Dec-2025 sits in the "2026" column). Convert the
    // calendar month to its fiscal year before looking up the column —
    // otherwise July–December uploads would silently read the prior year's
    // comparative column.
    const calYear = parseInt(month.slice(0, 4), 10);
    const calMonth = parseInt(month.slice(5, 7), 10);
    const targetYear = calMonth >= 7 ? calYear + 1 : calYear;
    const valueCol = findYearCol(rows, targetYear);
    if (valueCol === null) {
      return NextResponse.json({ error: `Could not find a year column (e.g. ${targetYear}) in the "${bsSheetName}" sheet header.` }, { status: 422 });
    }
    ({ parsed, subtotals } = parseFace(rows, valueCol));

    // Notes (best-effort)
    try {
      const notesName = wb.SheetNames.find((n) => /^notes?$/i.test(n.trim()));
      if (notesName) {
        const nRows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[notesName], { header: 1, defval: null, raw: true });
        const nCol = findYearCol(nRows, targetYear);
        if (nCol !== null) noteLines = parseNotes(nRows, nCol);
      }
    } catch { noteLines = []; }
  } catch (e) {
    return NextResponse.json({ error: "Could not read this file: " + (e instanceof Error ? e.message : String(e)) }, { status: 400 });
  }

  const t = totals(parsed);

  // Prior period for comparisons — total_assets summed in Postgres via RPC (Rule 0)
  const { data: priorRaw } = await supabase
    .rpc("get_ifl_bs_prior_totals", { p_company_id: IFPL_COMPANY_ID, p_month: month })
    .maybeSingle();
  const priorData = priorRaw as { total_assets: number; cash_bank: number; retained_earnings: number } | null;
  const prior = priorData ? {
    total_assets: Number(priorData.total_assets ?? 0),
    cash_bank: Number(priorData.cash_bank ?? 0),
    retained_earnings: Number(priorData.retained_earnings ?? 0),
  } : null;

  const checks = runChecks(parsed, subtotals);
  const warnings = auditWarnings(parsed, prior);
  const accepted = checks.filter((c) => !c.passed && c.name.includes("equation")).length === 0;

  if (!accepted) {
    return NextResponse.json({
      accepted: false, month, sheetUsed, checks, auditWarnings: warnings,
      summary: `Rejected — Balance Sheet does not balance. Difference: ${fmt(Math.abs(t.totalAssets - t.totalEqLiab))}. Fix the source file and re-upload.`,
    }, { status: 422 });
  }

  const lineItems = Object.fromEntries(FIELDS.map((f) => [f, parsed[f]]));
  const { error: dbErr } = await supabase.from("balance_sheet_ifl").upsert(
    {
      company_id: IFPL_COMPANY_ID, month, ...lineItems, uploaded_by: auth.email,
      checks_passed: checks.filter((c) => c.passed).length,
      checks_failed: checks.filter((c) => !c.passed).length,
      audit_warnings: warnings,
    },
    { onConflict: "company_id,month" }
  );
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  // Save note lines (best-effort)
  let notesSaved = 0;
  if (noteLines.length > 0) {
    const { error: delErr } = await supabase.from("balance_sheet_notes").delete()
      .eq("company_id", IFPL_COMPANY_ID).eq("month", month);
    if (!delErr) {
      const { error: notesErr } = await supabase.from("balance_sheet_notes").insert(
        noteLines.map((l) => ({ company_id: IFPL_COMPANY_ID, month, ...l }))
      );
      if (!notesErr) notesSaved = noteLines.length;
    }
  }

  const failed = checks.filter((c) => !c.passed);
  return NextResponse.json({
    accepted: true, month, sheetUsed, checks, auditWarnings: warnings, parsed: lineItems, notesSaved,
    summary: failed.length > 0
      ? `Saved — ${checks.length - failed.length}/${checks.length} checks passed (${failed.length} issue${failed.length > 1 ? "s" : ""} to review).`
      : warnings.length > 0
      ? `All ${checks.length} checks passed — ${warnings.length} audit warning${warnings.length > 1 ? "s" : ""} to review.`
      : `All ${checks.length} checks passed. Balance Sheet balances correctly.`,
  });
}
