import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { UTPL_COMPANY_ID, IFPL_COMPANY_ID, BRNH_COMPANY_ID, HD_COMPANY_ID, KKJ_COMPANY_ID } from "../../../lib/constants";
import { isAdmin } from "../../../lib/admin-config";

// ── Auth helpers ──────────────────────────────────────────────────────────────
const RESTAURANT_COMPANIES = ["BRNH", "HD", "KKJ"];

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

// Read-only access: banking users + restaurant-pnl users (for BRNH/HD/KKJ only)
async function checkReadAccess(
  email: string,
  supabase: ReturnType<typeof createServiceClient>,
  company?: string,
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
    .select("can_access_banking, can_view_restaurants_pnl")
    .eq("member_id", member.id)
    .single();
  if (perm?.can_access_banking === true) return true;
  if (perm?.can_view_restaurants_pnl === true && company && RESTAURANT_COMPANIES.includes(company)) return true;
  return false;
}

// ── GET /api/banking/cash-sheets?company=IFPL&month=2026-07 ──────────────────

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();

  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") || "UTPL";
  const month = searchParams.get("month"); // e.g. "2026-07"

  if (!(await checkReadAccess(auth.email, supabase, company))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const SELECT = `id, company, sheet_date, source, pdf_storage_path,
    opening_balance_pkr, closing_balance_pkr, receipts_pkr, payments_pkr,
    notes, uploaded_by, created_at,
    cash_sheet_transactions ( id, txn_type, amount_pkr )`;

  let result;

  if (month) {
    const [y, m] = month.split("-").map(Number);
    const start = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    result = await supabase
      .from("cash_sheet_uploads")
      .select(SELECT)
      .eq("company", company)
      .gte("sheet_date", start)
      .lte("sheet_date", end)
      .order("sheet_date", { ascending: false });
  } else {
    result = await supabase
      .from("cash_sheet_uploads")
      .select(SELECT)
      .eq("company", company)
      .order("sheet_date", { ascending: false })
      .limit(60);
  }

  if (result.error) return Response.json({ error: result.error.message }, { status: 500 });

  // Continuity audit (whole history for this company, done in the database):
  // previous day's closing must match the next day's opening. Breaks are
  // surfaced as alerts on the page so corrupted/wrong figures get fixed.
  const { data: continuity, error: contErr } = await supabase.rpc("cash_sheet_continuity", { p_company: company });
  if (contErr) console.error("Continuity audit error:", contErr.message);

  return Response.json({ data: result.data, continuity: continuity ?? [] });
}

// ── POST /api/banking/cash-sheets ─────────────────────────────────────────────

type TxnInput = {
  txn_type: "payment" | "receipt";
  description: string;
  amount_pkr: number;
  bank_account?: string;
  reference?: string;
  category?: string;
  sort_order?: number;
};

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  if (!(await checkBankingAccess(auth.email, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const body = await request.json();
  const {
    company,
    sheet_date,
    opening_balance_pkr,
    closing_balance_pkr,
    notes,
    pdf_storage_path,
    transactions = [],
    // Parsed totals from the PDF upload step — used to keep daily_cash_position in sync
    total_receipts,
    total_payments,
    post_dated_total,
    closing_after_post_dated,
    pdc_buckets = [],
  } = body as {
    company: string;
    sheet_date: string;
    opening_balance_pkr?: number;
    closing_balance_pkr?: number;
    notes?: string;
    pdf_storage_path?: string;
    transactions?: TxnInput[];
    total_receipts?: number;
    total_payments?: number;
    post_dated_total?: number;
    closing_after_post_dated?: number;
    pdc_buckets?: { dueDate: string; amount: number; label: string | null }[];
  };

  if (!company || !sheet_date) {
    return Response.json({ error: "company and sheet_date are required" }, { status: 400 });
  }
  const VALID_COMPANIES = ["IFPL", "UTPL", "BRNH", "HD", "KKJ"];
  if (!VALID_COMPANIES.includes(company)) {
    return Response.json({ error: `company must be one of: ${VALID_COMPANIES.join(", ")}` }, { status: 400 });
  }

  // 1. Upsert sheet header — upsert so that re-uploads for the same date update
  //    rather than conflict, and so Finance-tab rows are enriched rather than duplicated.
  const { data: sheet, error: sheetErr } = await supabase
    .from("cash_sheet_uploads")
    .upsert(
      {
        company,
        sheet_date,
        opening_balance_pkr: opening_balance_pkr ?? null,
        closing_balance_pkr: closing_balance_pkr ?? null,
        receipts_pkr: total_receipts ?? null,
        payments_pkr: total_payments ?? null,
        notes: notes || null,
        pdf_storage_path: pdf_storage_path || null,
        uploaded_by: auth.email,
        source: "manual_upload",
      },
      { onConflict: "company,sheet_date" }
    )
    .select()
    .single();

  if (sheetErr) {
    return Response.json({ error: sheetErr.message }, { status: 500 });
  }

  // 2. Replace transactions (delete then re-insert for idempotency on re-upload)
  if (transactions.length > 0) {
    await supabase.from("cash_sheet_transactions").delete().eq("sheet_id", sheet.id);
    const rows = transactions.map((t, i) => ({
      sheet_id: sheet.id,
      company,
      sheet_date,
      txn_type: t.txn_type,
      description: t.description,
      amount_pkr: t.amount_pkr,
      bank_account: t.bank_account || null,
      reference: t.reference || null,
      category: t.category || null,
      sort_order: t.sort_order ?? i,
    }));
    const { error: txnErr } = await supabase.from("cash_sheet_transactions").insert(rows);
    if (txnErr) {
      return Response.json({
        ok: true,
        data: sheet,
        warning: "Sheet saved but transactions failed: " + txnErr.message,
      });
    }
  }

  // 3. Mirror to daily_cash_position so the Banking overview chart stays current.
  //    Only write when we have at least one balance figure — avoids a blank placeholder row.
  const hasBalance =
    opening_balance_pkr != null ||
    closing_balance_pkr != null ||
    total_receipts != null ||
    total_payments != null;

  if (hasBalance) {
    const COMPANY_ID_MAP: Record<string, string> = {
      UTPL: UTPL_COMPANY_ID,
      IFPL: IFPL_COMPANY_ID,
      BRNH: BRNH_COMPANY_ID,
      HD:   HD_COMPANY_ID,
      KKJ:  KKJ_COMPANY_ID,
    };
    const companyId = COMPANY_ID_MAP[company];
    const { error: dcpErr } = await supabase
      .from("daily_cash_position")
      .upsert(
        {
          company_id: companyId,
          position_date: sheet_date,
          opening_balance: opening_balance_pkr ?? 0,
          total_receipts: total_receipts ?? 0,
          total_payments: total_payments ?? 0,
          closing_balance: closing_balance_pkr ?? 0,
          post_dated_total: post_dated_total ?? 0,
          closing_after_post_dated: closing_after_post_dated ?? closing_balance_pkr ?? 0,
          source: "manual",
          uploaded_by: auth.email,
          cash_sheet_id: sheet.id,
        },
        { onConflict: "company_id,position_date" }
      );

    if (dcpErr) {
      console.error("daily_cash_position upsert failed:", dcpErr.message);
      // Non-blocking — sheet is saved, just log the error
    }

    // Replace the day's PDC maturity buckets (feeds the Finance pages' PDC
    // outlook) — same replace-not-append rule as the finance ingestion path.
    if (pdc_buckets.length > 0) {
      await supabase.from("pdc_maturity_buckets")
        .delete().eq("company_id", companyId).eq("position_date", sheet_date);
      const { error: pdcErr } = await supabase.from("pdc_maturity_buckets").insert(
        pdc_buckets
          .filter((b) => b && typeof b.amount === "number" && /^\d{4}-\d{2}-\d{2}$/.test(b.dueDate || ""))
          .map((b) => ({
            company_id: companyId,
            position_date: sheet_date,
            due_date: b.dueDate,
            amount: b.amount,
            label: b.label ?? null,
          }))
      );
      if (pdcErr) console.error("pdc_maturity_buckets insert failed:", pdcErr.message);
    }
  }

  return Response.json({ ok: true, data: sheet });
}
