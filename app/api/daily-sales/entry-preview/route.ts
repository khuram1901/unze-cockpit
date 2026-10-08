/**
 * POST /api/daily-sales/entry-preview
 *
 * Computes live totals for a partial daily-sales form entry without
 * writing any data. Used by the /daily-sales form to show the user
 * real-time calculated totals as they type.
 *
 * Calls daily_entry_preview(p_store_id, p_date, p_fields) — accessible
 * to CEO/Admin by role OR any member with can_access_daily_sales = true.
 *
 * Store users: store_id is derived server-side and any client-sent
 * store_id is overridden. HOD/admin may pass any store_id.
 *
 * Body: {
 *   store_id: string,         ← overridden for store users
 *   sales_date: string,       ← YYYY-MM-DD
 *   fields: {
 *     cash_sale, campaign_float_cash, expenses, other_income, deposit,
 *     allied_bank_cc_sale, hbl_cc_sale, gift_karte, gift_vouchers,
 *     credit_notes_issue
 *   }
 * }
 *
 * Returns: {
 *   totals: {
 *     total_credit_card_sale, total_sale, net_cash_movement,
 *     opening_balance, closing_balance
 *   }
 * }
 */
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../lib/api-auth";

const STORE_USER_RE = /^store\d{3}@unze\.co\.uk$/i;

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  let body: { store_id: string; sales_date: string; fields: Record<string, number> };
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.store_id || !body.sales_date || !body.fields) {
    return Response.json({ error: "store_id, sales_date and fields required" }, { status: 400 });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.sales_date)) {
    return Response.json({ error: "sales_date must be YYYY-MM-DD" }, { status: 400 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const uc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } }
  );

  // For store users, derive and override store_id server-side
  const isStoreUserByEmail = auth.email ? STORE_USER_RE.test(auth.email) : false;
  let storeId = body.store_id;

  if (isStoreUserByEmail) {
    const { data: derivedStoreId, error: rpcErr } = await uc.rpc("retail_store_for_user");
    if (rpcErr) {
      return Response.json({ error: rpcErr.message }, { status: 500 });
    }
    if (!derivedStoreId) {
      return Response.json({ error: "No store assignment found" }, { status: 403 });
    }
    storeId = derivedStoreId as string;
  }

  // Call the lightweight preview RPC
  const { data, error } = await uc.rpc("daily_entry_preview", {
    p_store_id: storeId,
    p_date:     body.sales_date,
    p_fields:   body.fields,
  });

  if (error) {
    const status = error.message.includes("access denied") ? 403 : 500;
    return Response.json({ error: error.message }, { status });
  }

  return Response.json({ totals: data });
}
