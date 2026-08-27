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

// ── Keyword matchers ─────────────────────────────────────────────────────────
const LINE_KEYWORDS: [keyof BsParsed, string[]][] = [
  ["ppe",                  ["property, plant", "ppe", "fixed assets (net)", "tangible fixed"]],
  ["long_term_investment",  ["long term invest", "long-term invest"]],
  ["receivables",           ["investment, deposit", "receivables", "trade receivables", "debtors"]],
  ["stocks",                ["stocks", "inventories", "stock -", "raw material", "finished goods"]],
  ["advances_prepayments",  ["advance & prepay", "advances & prepay", "advance and prepay", "prepayments"]],
  ["advance_taxation",      ["advance taxation", "advance tax"]],
  ["cash_bank",             ["cash at bank", "cash & bank", "cash and bank", "bank balances", "cash in hand"]],
  ["owner_capital",         ["owner capital", "owner's capital", "paid-up capital", "paid up capital", "share capital"]],
  ["revenue_reserves",      ["revenue reserves", "general reserve", "capital reserve"]],
  ["retained_earnings",     ["retained earnings", "accumulated profit", "profit & loss account", "profit and loss account", "accumulated loss"]],
  ["hbl_stf",               ["hbl", "short term facility", "stf", "bank overdraft", "running finance"]],
  ["loan_family",           ["loan from family", "family loan", "directors loan", "director's loan"]],
  ["mazhar_sb_ac",          ["mazhar", "mazhar sb"]],
  ["loan_associates",       ["loan from associates", "associates loan", "related party loan"]],
  ["lease_liabilities",     ["lease liabilit", "right-of-use", "rou liability", "finance lease"]],
  ["accrued_liabilities",   ["accrued liabilit", "accruals", "other payables"]],
  ["payable_controls",      ["payable control", "trade and other payable", "creditors", "trade payable"]],
  ["taxation",              ["taxation payable", "income tax payable", "tax payable", "provision for tax", "taxation -"]],
  // Reported subtotals
  ["r_total_fixed",         ["total fixed assets", "total non-current assets", "total tangible"]],
  ["r_total_current",       ["total current assets"]],
  ["r_total_assets",        ["total assets"]],
  ["r_total_equity",        ["total equity", "total capital & reserves", "total capital and reserves", "total shareholders"]],
  ["r_total_ncl",           ["total non-current liabilit", "total long term liabilit", "total ncl"]],
  ["r_total_cl",            ["total current liabilit"]],
  ["r_total_eq_liab",       ["total equity & liabilit", "total equity and liabilit", "total liabilit"]],
];

// Normally non-zero fields — flag these if they come back 0
const NORMALLY_NONZERO: (keyof BsParsed)[] = [
  "ppe", "receivables", "stocks", "advance_taxation", "cash_bank",
  "owner_capital", "revenue_reserves", "retained_earnings",
  "accrued_liabilities", "payable_controls", "taxation",
];

// ── Month auto-detection ─────────────────────────────────────────────────────
// Searches filename and sheet names for a readable month reference.
// Handles: "Jun-26", "Jun26", "June 2026", "2026-06", "26-06" etc.
function detectMonth(filename: string, wb: XLSX.WorkBook): string | null {
  const MONTH_SHORT: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  // Sources in priority order: filename (most likely to be labelled correctly), then sheet names
  const sources = [filename, ...wb.SheetNames];
  for (const src of sources) {
    const s = src.toLowerCase();

    // ① Named month + 2-or-4 digit year: "Jun-26" "june 2026" "Jun26"
    const named = s.match(
      /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[- _]?(\d{2,4})\b/
    );
    if (named) {
      const short = named[1].slice(0, 3);
      const mn = MONTH_SHORT[short];
      let yr = named[2];
      if (yr.length === 2) yr = `20${yr}`;
      if (mn && yr.length === 4) return `${yr}-${mn}-01`;
    }

    // ② ISO-ish: "2026-06" or "2026/06"
    const iso = s.match(/\b(20\d{2})[- /](\d{2})\b/);
    if (iso) {
      const yr = iso[1], mm = iso[2];
      if (parseInt(mm) >= 1 && parseInt(mm) <= 12) return `${yr}-${mm}-01`;
    }
  }
  return null;
}

function lastNonZeroNum(row: unknown[]): number | null {
  let last: number | null = null;
  for (let i = 1; i < row.length; i++) {
    const v = row[i];
    if (typeof v === "number" && !Number.isNaN(v) && v !== 0) last = v;
  }
  return last;
}
function firstNum(row: unknown[]): number | null {
  for (let i = 1; i < row.length; i++) {
    const v = row[i];
    if (typeof v === "number" && !Number.isNaN(v)) return v;
  }
  return null;
}

function findValue(rows: unknown[][], keywords: string[]): number {
  for (const row of rows) {
    const label = String(row[0] ?? row[1] ?? "").toLowerCase().trim();
    if (keywords.some((k) => label.includes(k.toLowerCase()))) {
      const v = lastNonZeroNum(row) ?? firstNum(row);
      if (v !== null) return v;
    }
  }
  return 0;
}

function findBsSheet(wb: XLSX.WorkBook): { sheet: XLSX.WorkSheet; name: string } | null {
  const preferred = wb.SheetNames.find((n) =>
    /bs\s*\(\s*r\s*\)/i.test(n.replace(/\s/g, "")) || /^bs[\s_-]?r$/i.test(n.trim())
  );
  if (preferred) return { sheet: wb.Sheets[preferred], name: preferred };
  const fallback = wb.SheetNames.find((n) => /\bbs\b/i.test(n));
  if (fallback) return { sheet: wb.Sheets[fallback], name: fallback };
  return null;
}

function parseSheet(wb: XLSX.WorkBook): { parsed: BsParsed; sheetUsed: string } | { error: string } {
  const found = findBsSheet(wb);
  if (!found) {
    return { error: `No Balance Sheet sheet found. Available sheets: ${wb.SheetNames.join(", ")}. Expecting a sheet named "BS (R)" or similar.` };
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(found.sheet, { header: 1, defval: null });
  const parsed = {} as BsParsed;
  for (const [field, keywords] of LINE_KEYWORDS) {
    (parsed as Record<string, number>)[field] = findValue(rows, keywords);
  }
  return { parsed, sheetUsed: found.name };
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
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });

    // Auto-detect month from filename and sheet names
    const detected = detectMonth(file.name, wb);
    if (!detected) {
      return NextResponse.json({
        error: `Could not detect the month from the filename "${file.name}" or sheet names (${wb.SheetNames.join(", ")}). ` +
          `Rename the file to include the month, e.g. "Balance Sheet Jun-26.xlsx", and re-upload.`,
      }, { status: 422 });
    }
    month = detected;

    const result = parseSheet(wb);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 422 });
    parsed = result.parsed;
    sheetUsed = result.sheetUsed;
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
    .select("*")
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
    .select("*")
    .eq("company_id", UTPL_COMPANY_ID)
    .eq("month", month)
    .limit(1);
  const existing = existingRows?.[0];
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
    // audit_warnings column may not exist yet — retry without it
    const { error: dbErr2 } = await supabase.from("balance_sheet").upsert(
      { company_id: UTPL_COMPANY_ID, month, ...lineItems, uploaded_by: auth.email },
      { onConflict: "company_id,month" }
    );
    if (dbErr2) return NextResponse.json({ error: dbErr2.message }, { status: 500 });
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
    summary: checksFailed.length > 0
      ? `Saved — ${checks.length - checksFailed.length}/${checks.length} checks passed (${checksFailed.length} issue${checksFailed.length > 1 ? "s" : ""} to review below).`
      : warnings.length > 0
      ? `All ${checks.length} checks passed — ${warnings.length} audit warning${warnings.length > 1 ? "s" : ""} to review.`
      : `All ${checks.length} checks passed. Balance Sheet balances correctly.`,
  });
}
