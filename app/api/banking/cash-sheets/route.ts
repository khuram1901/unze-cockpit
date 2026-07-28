import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { UTPL_COMPANY_ID, IFPL_COMPANY_ID } from "../../../lib/constants";

// ── Auth helper ───────────────────────────────────────────────────────────────

async function checkBankingAccess(
  email: string,
  supabase: ReturnType<typeof createServiceClient>,
): Promise<boolean> {
  const ADMIN = ["khuram1901@gmail.com", "k.saleem@unzegroup.com"];
  if (ADMIN.includes(email.toLowerCase())) return true;
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

// ── GET /api/banking/cash-sheets?company=IFPL&month=2026-07 ──────────────────

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  if (!(await checkBankingAccess(auth.email, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") || "UTPL";
  const month = searchParams.get("month"); // e.g. "2026-07"

  const SELECT = `id, company, sheet_date, source, pdf_storage_path,
    opening_balance_pkr, closing_balance_pkr, notes, uploaded_by, created_at,
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
  return Response.json({ data: result.data });
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
  };

  if (!company || !sheet_date) {
    return Response.json({ error: "company and sheet_date are required" }, { status: 400 });
  }
  if (!["IFPL", "UTPL"].includes(company)) {
    return Response.json({ error: "company must be IFPL or UTPL" }, { status: 400 });
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
    const companyId = company === "IFPL" ? IFPL_COMPANY_ID : UTPL_COMPANY_ID;
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
  }

  return Response.json({ ok: true, data: sheet });
}
