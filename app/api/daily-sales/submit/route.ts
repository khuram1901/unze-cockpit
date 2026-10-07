/**
 * POST /api/daily-sales/submit
 *
 * Store-user daily sales entry submission.
 * Uses the caller's JWT client so Postgres RLS applies — store users
 * can only INSERT/UPDATE rows where store_id matches their assigned store.
 *
 * Body: {
 *   store_id: string,
 *   sales_date: string (YYYY-MM-DD),
 *   cash_sale: number,
 *   campaign_float_cash?: number,
 *   expenses?: number,
 *   other_income?: number,
 *   deposit?: number,
 *   allied_bank_cc_sale?: number,
 *   hbl_cc_sale?: number,
 *   gift_karte?: number,
 *   gift_vouchers?: number,
 *   credit_notes_issue?: number,
 *   remarks?: string | null,
 * }
 *
 * Returns: { ok: true } on success.
 */
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../lib/api-auth";

interface SubmitBody {
  store_id: string;
  sales_date: string;
  cash_sale: number;
  campaign_float_cash?: number;
  expenses?: number;
  other_income?: number;
  deposit?: number;
  allied_bank_cc_sale?: number;
  hbl_cc_sale?: number;
  gift_karte?: number;
  gift_vouchers?: number;
  credit_notes_issue?: number;
  remarks?: string | null;
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  let body: SubmitBody;
  try {
    body = await request.json() as SubmitBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.store_id || !body.sales_date) {
    return Response.json({ error: "store_id and sales_date are required" }, { status: 400 });
  }

  // Validate date format YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.sales_date)) {
    return Response.json({ error: "sales_date must be YYYY-MM-DD" }, { status: 400 });
  }

  if (typeof body.cash_sale !== "number" || body.cash_sale < 0) {
    return Response.json({ error: "cash_sale is required and must be non-negative" }, { status: 400 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  // User client — RLS enforces store ownership
  const uc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const row = {
    store_id:             body.store_id,
    sales_date:           body.sales_date,
    cash_sale:            body.cash_sale,
    campaign_float_cash:  body.campaign_float_cash  ?? 0,
    expenses:             body.expenses             ?? 0,
    other_income:         body.other_income         ?? 0,
    deposit:              body.deposit              ?? 0,
    allied_bank_cc_sale:  body.allied_bank_cc_sale  ?? 0,
    hbl_cc_sale:          body.hbl_cc_sale          ?? 0,
    gift_karte:           body.gift_karte           ?? 0,
    gift_vouchers:        body.gift_vouchers        ?? 0,
    credit_notes_issue:   body.credit_notes_issue   ?? 0,
    remarks:              body.remarks              ?? null,
  };

  const { error } = await uc
    .from("daily_sales")
    .upsert(row, { onConflict: "store_id,sales_date" });

  if (error) {
    // RLS violation → 403
    if (error.code === "42501") {
      return Response.json(
        { error: "You are not authorised to submit for this store." },
        { status: 403 }
      );
    }
    // Unique-constraint or locked-date trigger → surface message
    if (error.code === "23505") {
      return Response.json(
        { error: "An entry for this date already exists and cannot be overwritten." },
        { status: 409 }
      );
    }
    if (error.message?.toLowerCase().includes("locked")) {
      return Response.json(
        { error: "This date is locked and cannot be edited. Contact your area manager." },
        { status: 409 }
      );
    }
    console.error("[daily-sales/submit]", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
