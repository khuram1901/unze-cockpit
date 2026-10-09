/**
 * GET  /api/daily-sales/opening-balances?year=2026&month=10
 *   Returns all stores + their opening balance for the requested month.
 *   Requires has_widget('imperial.retail_sales').
 *
 * POST /api/daily-sales/opening-balances
 *   Body: { store_id, amount, opening_date, notes? }
 *   Calls set_opening_balance() RPC (SECURITY DEFINER — checks widget internally).
 *
 * PATCH /api/daily-sales/opening-balances
 *   Body: { store_id, amount, opening_date, reason, notes? }
 *   Calls edit_opening_balance() RPC.
 */
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";

const ADMIN_EMAILS = /k\.saleem@unzegroup\.com|kamran@unze\.co\.uk/i;

function userClient(authHeader: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } }
  );
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const year  = parseInt(searchParams.get("year")  ?? "", 10);
  const month = parseInt(searchParams.get("month") ?? "", 10);

  if (!year || !month || month < 1 || month > 12) {
    return Response.json({ error: "year and month required" }, { status: 400 });
  }

  // Service client: list all stores, then join opening balances
  const db = createServiceClient();

  // Admin/CEO bypass — always allowed (widget_overrides rows were deleted in migration 258)
  if (!ADMIN_EMAILS.test(auth.email ?? "")) {
    // Non-admin: check widget via members + member_widget_overrides
    const { data: member } = await db
      .from("members")
      .select("id")
      .eq("email", auth.email)
      .maybeSingle();

    if (!member) return Response.json({ error: "Forbidden" }, { status: 403 });

    const { data: widgetRow } = await db
      .from("member_widget_overrides")
      .select("visible")
      .eq("member_id", member.id)
      .eq("widget_key", "imperial.retail_sales")
      .maybeSingle();

    if (!widgetRow?.visible) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonthStart = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  const { data: stores, error: storesErr } = await db
    .from("stores")
    .select("id, fm_code, name, email")
    .eq("is_active", true)
    .order("fm_code");

  if (storesErr) return Response.json({ error: storesErr.message }, { status: 500 });

  const { data: balances, error: balErr } = await db
    .from("store_opening_balances")
    .select("store_id, amount, opening_date, notes, set_at")
    .gte("opening_date", monthStart)
    .lt("opening_date", nextMonthStart);

  if (balErr) return Response.json({ error: balErr.message }, { status: 500 });

  const balMap = new Map((balances ?? []).map((b) => [b.store_id, b]));

  const result = (stores ?? []).map((s) => ({
    ...s,
    balance: balMap.get(s.id) ?? null,
  }));

  return Response.json({ stores: result, month_start: monthStart });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const body = await request.json() as {
    store_id: string;
    amount: number;
    opening_date: string;
    notes?: string;
  };

  if (!body.store_id || body.amount == null || !body.opening_date) {
    return Response.json({ error: "store_id, amount, opening_date required" }, { status: 400 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const uc = userClient(authHeader);

  const { error } = await uc.rpc("set_opening_balance", {
    p_store_id:    body.store_id,
    p_amount:      body.amount,
    p_opening_date: body.opening_date,
    p_notes:       body.notes ?? null,
  });

  if (error) {
    const status = error.message.includes("requires the imperial.retail_sales widget") ? 403 : 500;
    return Response.json({ error: error.message }, { status });
  }

  return Response.json({ ok: true });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const body = await request.json() as {
    store_id: string;
    amount: number;
    opening_date: string;
    reason: string;
    notes?: string;
  };

  if (!body.store_id || body.amount == null || !body.opening_date || !body.reason) {
    return Response.json({ error: "store_id, amount, opening_date, reason required" }, { status: 400 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const uc = userClient(authHeader);

  const { error } = await uc.rpc("edit_opening_balance", {
    p_store_id:    body.store_id,
    p_amount:      body.amount,
    p_opening_date: body.opening_date,
    p_reason:      body.reason,
    p_notes:       body.notes ?? null,
  });

  if (error) {
    const status = error.message.includes("requires the imperial.retail_sales widget") ? 403 : 500;
    return Response.json({ error: error.message }, { status });
  }

  return Response.json({ ok: true });
}
