import { NextRequest } from "next/server";
import { createServiceClient } from "../../../../../lib/supabase-server";
import { requireAuth } from "../../../../../lib/api-auth";
import { parseCashFlowPDF } from "../../../../../lib/pdf-parsers/cash-flow-parser";
import { isAdmin } from "../../../../../lib/admin-config";

// ── Auth helper (same as ../route.ts) ────────────────────────────────────────

async function checkBankingAccess(
  email: string,
  supabase: ReturnType<typeof createServiceClient>,
): Promise<boolean> {
  if (isAdmin(email.toLowerCase())) return true;
  const { data: member } = await supabase
    .from("members")
    .select("id")
    .eq("email", email)
    .single();
  if (!member) return false;
  const { data: perm } = await supabase
    .from("member_permissions")
    .select("can_access_banking")
    .eq("member_id", member.id)
    .single();
  return perm?.can_access_banking === true;
}

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
  if (!(await checkBankingAccess(auth.email, supabase))) {
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
  let parseWarning: string | null = null;

  try {
    const results = await parseCashFlowPDF(buffer);
    if (results.length > 0) {
      const r = results[0];
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

  return Response.json({ ok: true, path, parsed, parseWarning });
}
