import { NextRequest } from "next/server";
import { createServiceClient } from "../../../../../lib/supabase-server";
import { requireAuth } from "../../../../../lib/api-auth";
import { UTPL_COMPANY_ID, IFPL_COMPANY_ID, BRNH_COMPANY_ID, HD_COMPANY_ID, KKJ_COMPANY_ID } from "../../../../../lib/constants";
import { hasBankingAccess } from "../../../../../lib/banking-access";
import { parseCashFlowPDF } from "../../../../../lib/pdf-parsers/cash-flow-parser";

// ── Auth helper (same as ../route.ts) ────────────────────────────────────────


// ── POST /api/banking/cash-sheets/pdf/parse ──────────────────────────────────
// Parses a cash sheet PDF that is ALREADY in Supabase Storage (uploaded by the
// browser via a signed URL from ./upload-url). Downloading from storage inside
// the function avoids Vercel's request body limit entirely — the PDF never
// travels through a Vercel request.
//
// Body: { path: "HD/2026/2026-07-27.pdf" }
// Response: { ok, parsed: { opening, closing, receipts, payments }, parseWarning }

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  if (!(await hasBankingAccess(auth.email))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  let body: { path?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const path = body.path;
  // Only allow paths inside the known company folders — prevents using this
  // endpoint to read arbitrary objects.
  if (!path || !/^(IFPL|UTPL|BRNH|HD|KKJ)\/\d{4}\/\d{4}-\d{2}-\d{2}\.pdf$/.test(path)) {
    return Response.json({ error: "path must look like COMPANY/YYYY/YYYY-MM-DD.pdf" }, { status: 400 });
  }

  const { data: file, error: dlErr } = await supabase.storage
    .from("cash-sheets")
    .download(path);

  if (dlErr || !file) {
    return Response.json({ error: dlErr?.message || "PDF not found in storage" }, { status: 404 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed: {
    opening: number | null;
    closing: number | null;
    receipts: number | null;
    payments: number | null;
    pdc_total: number | null;
    closing_after_pdc: number | null;
    transactions: { txn_type: string; description: string; amount: number }[];
    pdc_buckets: { dueDate: string; amount: number; label: string | null }[];
  } = {
    opening: null, closing: null, receipts: null, payments: null,
    pdc_total: null, closing_after_pdc: null, transactions: [], pdc_buckets: [],
  };
  // 21/10/2026: a day with no payments or no receipts is normal (the sheet
  // prints "Total  -"). Only a MISSING Total line counts as unreadable.
  let totalsFound = { payments: false, receipts: false };
  let parseWarning: string | null = null;
  let detectedCompany: string | null = null;

  try {
    const results = await parseCashFlowPDF(buffer);
    if (results.length > 0) {
      const r = results[0];
      detectedCompany = r.company;
      totalsFound = r.totalsFound;
      parsed = {
        opening: r.openingBalanceTotal,
        closing: r.closingBalanceUnzeTrading,
        receipts: r.receiptsTotal,
        payments: r.paymentsTotal,
        pdc_total: r.loanPostDatedCHQs || null,
        closing_after_pdc: r.closingAfterLoanPostDated || null,
        transactions: r.transactions,
        pdc_buckets: r.pdcBuckets,
      };
    }
  } catch (parseErr) {
    parseWarning = parseErr instanceof Error ? parseErr.message : String(parseErr);
    console.warn("cash-sheets/pdf/parse: parse warning (non-fatal):", parseWarning);
  }

  // ── 18/10/2026: named checks, so the user is told WHICH figure failed
  // before anything is saved (the DB guard still enforces on save).
  const company = path.split("/")[0];
  const sheetDate = path.slice(-14, -4); // YYYY-MM-DD from .../YYYY-MM-DD.pdf
  const checks: { level: "error" | "warning"; message: string }[] = [];
  const f = (n: number | null) => n == null ? "—" : "PKR " + Math.round(n).toLocaleString("en-PK");

  const unread: string[] = [];
  if (parsed.opening == null || (parsed.opening === 0 && parsed.payments === 0)) unread.push("opening balance");
  if (parsed.closing == null) unread.push("closing balance");
  if (parsed.receipts == null || !totalsFound.receipts) unread.push("total receipts");
  if (parsed.payments == null || !totalsFound.payments) unread.push("total payments");
  if (unread.length > 0) {
    checks.push({ level: "error", message: `Could not read the ${unread.join(", ")} from the PDF. Enter the figure${unread.length > 1 ? "s" : ""} manually.` });
  } else {
    const eq = Math.abs((parsed.opening ?? 0) + (parsed.receipts ?? 0) - (parsed.payments ?? 0) - (parsed.closing ?? 0));
    if (eq > 100) {
      checks.push({ level: "error", message: `Figures don't add up: opening ${f(parsed.opening)} + receipts ${f(parsed.receipts)} − payments ${f(parsed.payments)} ≠ closing ${f(parsed.closing)} (out by ${f(eq)}).` });
    }
  }

  // ── Line-item sanity checks (22/10/2026) ─────────────────────────────────────
  // Two-layer guard against PDF parsing corruptions (e.g. a decimal point lost
  // during text extraction turning PKR 12 into PKR 3,126,070,200,000,112):
  //
  // Layer 1 — per-line cap: any single transaction above PKR 500,000,000 (50 crore)
  //   is almost certainly a parse error. The largest legitimate transaction on record
  //   is ~PKR 264M (a LESCO bill). Cap is set at ~2× that with headroom.
  //
  // Layer 2 — line-sum vs section-total cross-check: sum all receipt lines and
  //   compare to the PDF's parsed receipts total; same for payments. A mismatch
  //   means one or more lines were parsed incorrectly.
  //
  // Both checks produce ERRORS (blocking save), not warnings, because corrupt line
  // items directly corrupt the Daily Position totals shown to the CEO.

  const MAX_SINGLE_TXN = 500_000_000; // PKR 50 crore — well above any real transaction

  // Layer 1: per-line cap
  const suspiciousLines = parsed.transactions.filter(t => t.amount > MAX_SINGLE_TXN);
  if (suspiciousLines.length > 0) {
    for (const t of suspiciousLines) {
      checks.push({
        level: "error",
        message: `Suspicious line item: "${t.description}" shows ${f(t.amount)} — this is likely a PDF parsing error (decimal point lost). The largest real transaction on record is ~PKR 264M. Please check the PDF and enter the correct amount manually.`,
      });
    }
  }

  // Layer 2: line-sum vs section-total cross-check
  if (parsed.transactions.length > 0 && parsed.receipts != null && parsed.payments != null) {
    const lineReceiptsSum = parsed.transactions
      .filter(t => t.txn_type === "receipt")
      .reduce((s, t) => s + t.amount, 0);
    const linePaymentsSum = parsed.transactions
      .filter(t => t.txn_type === "payment")
      .reduce((s, t) => s + t.amount, 0);

    const receiptGap = Math.abs(lineReceiptsSum - parsed.receipts);
    const paymentGap = Math.abs(linePaymentsSum - parsed.payments);
    // Allow PKR 1 per line for rounding, plus a fixed PKR 100 floor
    const tolerance = Math.max(100, parsed.transactions.length * 1);

    if (receiptGap > tolerance) {
      checks.push({
        level: "error",
        message: `Receipt lines add up to ${f(lineReceiptsSum)} but the PDF total is ${f(parsed.receipts)} (gap: ${f(receiptGap)}). One or more receipt lines may have been parsed incorrectly.`,
      });
    }
    if (paymentGap > tolerance) {
      checks.push({
        level: "error",
        message: `Payment lines add up to ${f(linePaymentsSum)} but the PDF total is ${f(parsed.payments)} (gap: ${f(paymentGap)}). One or more payment lines may have been parsed incorrectly.`,
      });
    }
  }

  // Chain check against the previous available day (weekends/holidays are
  // simply the previous row — no calendar assumptions).
  const COMPANY_ID_MAP: Record<string, string> = { UTPL: UTPL_COMPANY_ID, IFPL: IFPL_COMPANY_ID, BRNH: BRNH_COMPANY_ID, HD: HD_COMPANY_ID, KKJ: KKJ_COMPANY_ID };
  const companyId = COMPANY_ID_MAP[company];
  if (companyId && parsed.opening != null) {
    const { data: prev } = await supabase
      .from("daily_cash_position")
      .select("position_date, closing_balance")
      .eq("company_id", companyId)
      .lt("position_date", sheetDate)
      .order("position_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prev && Math.abs(Number(prev.closing_balance) - parsed.opening) > 100) {
      const d = String(prev.position_date).split("-").reverse().join("/");
      checks.push({ level: "error", message: `Opening ${f(parsed.opening)} doesn't match ${d} closing ${f(Number(prev.closing_balance))} (out by ${f(Math.abs(Number(prev.closing_balance) - parsed.opening))}). Check the PDF is the right day/company.` });
    }
  }

  // Mis-filed PDF (e.g. a UTPL sheet uploaded under IFPL — happened 24/06/2026)
  const EXPECTED: Record<string, string> = { UTPL: "unze", IFPL: "imperial", BRNH: "baranh", HD: "dolci", KKJ: "kkj" };
  if (detectedCompany && detectedCompany !== "unknown" && EXPECTED[company] && detectedCompany !== EXPECTED[company]) {
    checks.push({ level: "error", message: `This PDF looks like a ${detectedCompany.toUpperCase()} cash sheet, but you are uploading it under ${company}.` });
  }

  if (parseWarning) checks.push({ level: "warning", message: parseWarning });

  return Response.json({ ok: true, path, parsed, parseWarning, checks });
}
