import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { UTPL_COMPANY_ID } from "../../../lib/constants";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

// ── keyword → column mapping ────────────────────────────────────────────────
// Each entry is [fieldName, [...keywords]] — first row whose label cell
// contains any keyword wins; we take the rightmost non-zero numeric value.
const FIELD_KEYWORDS: [string, string[]][] = [
  ["ppe",                  ["property, plant", "ppe", "fixed assets (net)", "tangible"]],
  ["long_term_investment",  ["long term invest", "long-term invest"]],
  ["receivables",           ["investment, deposit", "receivables", "debtors"]],
  ["stocks",                ["stocks", "inventories", "stock -"]],
  ["advances_prepayments",  ["advance & prepay", "advances & prepay", "advance and prepay"]],
  ["advance_taxation",      ["advance taxation", "advance tax"]],
  ["cash_bank",             ["cash at bank", "cash & bank", "cash and bank", "bank balances"]],
  ["owner_capital",         ["owner capital", "owner's capital", "paid-up capital", "paid up capital"]],
  ["revenue_reserves",      ["revenue reserves", "general reserve"]],
  ["retained_earnings",     ["retained earnings", "accumulated profit", "profit & loss account", "profit and loss account"]],
  ["hbl_stf",               ["hbl", "short term facility", "stf"]],
  ["loan_family",           ["loan from family", "family loan"]],
  ["mazhar_sb_ac",          ["mazhar", "mazhar sb"]],
  ["loan_associates",       ["loan from associates", "associates loan"]],
  ["lease_liabilities",     ["lease liabilit", "right-of-use", "rou liability"]],
  ["accrued_liabilities",   ["accrued liabilit", "accruals"]],
  ["payable_controls",      ["payable control", "trade and other payable", "creditors"]],
  ["taxation",              ["taxation payable", "income tax payable", "tax payable", "provision for tax"]],
];

// First numeric value found scanning left-to-right from col 1
function firstNum(row: unknown[]): number | null {
  for (let i = 1; i < row.length; i++) {
    const v = row[i];
    if (typeof v === "number" && !Number.isNaN(v)) return v;
  }
  return null;
}

// Last non-zero numeric value — useful when sheet has multiple month columns
function lastNonZeroNum(row: unknown[]): number | null {
  let last: number | null = null;
  for (let i = 1; i < row.length; i++) {
    const v = row[i];
    if (typeof v === "number" && !Number.isNaN(v) && v !== 0) last = v;
  }
  return last;
}

function findValue(rows: unknown[][], keywords: string[], useLastCol = false): number {
  for (const row of rows) {
    const label = String(row[0] ?? row[1] ?? "").toLowerCase().trim();
    if (keywords.some((k) => label.includes(k.toLowerCase()))) {
      const v = useLastCol ? lastNonZeroNum(row) : firstNum(row);
      if (v !== null) return v;
    }
  }
  return 0;
}

function findBsSheet(wb: XLSX.WorkBook): XLSX.WorkSheet | null {
  // Prefer a sheet whose name matches "BS (R)" or similar
  const preferred = wb.SheetNames.find((n) =>
    /bs\s*\(\s*r\s*\)/i.test(n) || /^bs[\s_-]?r$/i.test(n.trim())
  );
  if (preferred) return wb.Sheets[preferred];
  // Fall back to any sheet containing "BS"
  const fallback = wb.SheetNames.find((n) => /\bbs\b/i.test(n));
  if (fallback) return wb.Sheets[fallback];
  return null;
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const monthRaw = formData.get("month") as string | null; // expected: YYYY-MM

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!monthRaw || !/^\d{4}-\d{2}$/.test(monthRaw))
    return NextResponse.json({ error: "Provide month as YYYY-MM" }, { status: 400 });

  if (file.size > MAX_FILE_SIZE)
    return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 400 });

  const month = `${monthRaw}-01`; // store as first-of-month date

  // ── Parse xlsx ────────────────────────────────────────────────────────────
  let rows: unknown[][];
  let sheetUsed: string;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
    const sheet = findBsSheet(wb);
    if (!sheet) {
      return NextResponse.json({
        error: `Could not find a Balance Sheet sheet. Sheets found: ${wb.SheetNames.join(", ")}`,
      }, { status: 422 });
    }
    sheetUsed = wb.SheetNames.find((n) => wb.Sheets[n] === sheet)!;
    rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  } catch (e) {
    return NextResponse.json({ error: `Failed to read xlsx: ${e instanceof Error ? e.message : String(e)}` }, { status: 422 });
  }

  // ── Extract values ────────────────────────────────────────────────────────
  // Try last-column first (multi-month summary sheets), fall back to first col
  const parsed: Record<string, number> = {};
  for (const [field, keywords] of FIELD_KEYWORDS) {
    const v = findValue(rows, keywords, true) || findValue(rows, keywords, false);
    parsed[field] = v;
  }

  // ── Upsert ────────────────────────────────────────────────────────────────
  const supabase = createServiceClient();
  const { error: dbErr } = await supabase.from("balance_sheet").upsert(
    {
      company_id: UTPL_COMPANY_ID,
      month,
      ...parsed,
      uploaded_by: auth.email,
    },
    { onConflict: "company_id,month" }
  );

  if (dbErr)
    return NextResponse.json({ error: dbErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, month, sheetUsed, parsed });
}
