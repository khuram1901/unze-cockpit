import { NextRequest } from "next/server";
import { createServiceClient } from "../../../../lib/supabase-server";
import { requireAuth } from "../../../../lib/api-auth";
import { hasBankingAccess, hasCashSheetReadAccess } from "../../../../lib/banking-access";
import {
  UTPL_COMPANY_ID, IFPL_COMPANY_ID, BRNH_COMPANY_ID, HD_COMPANY_ID, KKJ_COMPANY_ID,
} from "../../../../lib/constants";

// cash_sheet_uploads.company → the companies.id used by daily_cash_position
// and pdc_maturity_buckets. Kept in step with the POST route's own map.
const COMPANY_ID_MAP: Record<string, string> = {
  UTPL: UTPL_COMPANY_ID,
  IFPL: IFPL_COMPANY_ID,
  BRNH: BRNH_COMPANY_ID,
  HD:   HD_COMPANY_ID,
  KKJ:  KKJ_COMPANY_ID,
};

// ── Auth helpers ──────────────────────────────────────────────────────────────


// Read-only: banking users + restaurants_pnl users for restaurant companies

// ── GET /api/banking/cash-sheets/[id] ─────────────────────────────────────────

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id } = await context.params;

  const supabase = createServiceClient();

  // Fetch sheet first so we can pass company to the auth check
  // Header + line sums from the view (migration 276) — sums are not done here.
  const { data, error } = await supabase
    .from("cash_sheet_uploads_with_totals")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "Not found" }, { status: 404 });

  if (!(await hasCashSheetReadAccess(auth.email, data.company))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  // Lines, ordered by the database
  const { data: txns, error: txnErr } = await supabase
    .from("cash_sheet_transactions")
    .select("*")
    .eq("sheet_id", id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (txnErr) return Response.json({ error: txnErr.message }, { status: 500 });
  const receipts = (txns ?? []).filter((t) => t.txn_type === "receipt");
  const payments = (txns ?? []).filter((t) => t.txn_type === "payment");

  // Generate signed URL for PDF if present
  let pdf_signed_url: string | null = null;
  if (data.pdf_storage_path) {
    const { data: signed } = await supabase.storage
      .from("cash-sheets")
      .createSignedUrl(data.pdf_storage_path, 3600);
    pdf_signed_url = signed?.signedUrl ?? null;
  }

  return Response.json({
    data: {
      ...data,
      receipts,
      payments,
      // DB-computed line sums (view columns) — the page shows these, never sums lines itself
      line_receipts_pkr: Number(data.line_receipts_pkr ?? 0),
      line_payments_pkr: Number(data.line_payments_pkr ?? 0),
      pdf_signed_url,
    },
  });
}

// ── PATCH /api/banking/cash-sheets/[id] ──────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id } = await context.params;

  const supabase = createServiceClient();
  if (!(await hasBankingAccess(auth.email))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const body = await request.json();
  const { opening_balance_pkr, closing_balance_pkr, notes, pdf_storage_path } = body;

  const { error } = await supabase
    .from("cash_sheet_uploads")
    .update({
      ...(opening_balance_pkr !== undefined && { opening_balance_pkr }),
      ...(closing_balance_pkr !== undefined && { closing_balance_pkr }),
      ...(notes !== undefined && { notes }),
      ...(pdf_storage_path !== undefined && { pdf_storage_path }),
    })
    .eq("id", id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

// ── DELETE /api/banking/cash-sheets/[id] ─────────────────────────────────────

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id } = await context.params;

  const supabase = createServiceClient();
  if (!(await hasBankingAccess(auth.email))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  // Fetch the day's identity before deleting — we need company + date to clear
  // the mirrored rows below, not just the PDF path.
  const { data: sheet } = await supabase
    .from("cash_sheet_uploads")
    .select("pdf_storage_path, company, sheet_date")
    .eq("id", id)
    .single();

  const { error } = await supabase
    .from("cash_sheet_uploads")
    .delete()
    .eq("id", id);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // The cash sheet is mirrored into daily_cash_position (which feeds the
  // Banking overview, the Finance pages and the continuity audit) and into
  // pdc_maturity_buckets. daily_cash_position's FK is ON DELETE SET NULL, so
  // deleting the sheet used to leave the day's figures on screen forever —
  // re-uploading looked like it "did nothing" because the stale mirrored row
  // was what the pages were reading. Clear both here so a delete is a delete.
  const warnings: string[] = [];
  const companyId = sheet?.company ? COMPANY_ID_MAP[sheet.company] : undefined;
  if (companyId && sheet?.sheet_date) {
    const { error: dcpErr } = await supabase
      .from("daily_cash_position")
      .delete()
      .eq("company_id", companyId)
      .eq("position_date", sheet.sheet_date);
    if (dcpErr) warnings.push(`daily_cash_position: ${dcpErr.message}`);

    const { error: pdcErr } = await supabase
      .from("pdc_maturity_buckets")
      .delete()
      .eq("company_id", companyId)
      .eq("position_date", sheet.sheet_date);
    if (pdcErr) warnings.push(`pdc_maturity_buckets: ${pdcErr.message}`);
  } else if (sheet?.company) {
    warnings.push(`no company id mapped for "${sheet.company}" — mirrored rows left in place`);
  }

  // Remove PDF from storage (best-effort)
  if (sheet?.pdf_storage_path) {
    const { error: rmErr } = await supabase.storage.from("cash-sheets").remove([sheet.pdf_storage_path]);
    if (rmErr) warnings.push(`storage: ${rmErr.message}`);
  }

  // Surfaced rather than swallowed: a half-finished delete is exactly the
  // state that made this bug so confusing.
  if (warnings.length > 0) {
    console.error("cash-sheets DELETE: partial cleanup:", warnings.join("; "));
    return Response.json({ ok: true, warning: `Sheet deleted, but some linked data could not be cleared: ${warnings.join("; ")}` });
  }

  return Response.json({ ok: true });
}
