/**
 * GET /api/daily-sales/rows?store_id=<uuid>&year=2026&month=9
 *
 * Returns all rows from daily_sales_computed for a given store + month.
 * Requires either:
 *   - has_widget('imperial.retail_sales')  — Finance Manager / HOD view
 *   - can_access_daily_sales = true in member_permissions — store user (own store only)
 *
 * Store identity for store users is resolved server-side via retail_store_for_user().
 * If a store user sends a store_id that doesn't match their assigned store the
 * server overrides it with the DB-derived value; the RLS on the view will
 * then return zero rows for any other store, providing a second enforcement layer.
 *
 * HOD/FM users (has_widget) may pass any store_id — the view's RLS allows it.
 *
 * The view itself enforces RLS (security_invoker = true), so we call it with
 * the user's own JWT so the DB applies the caller's policies.
 */
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../lib/api-auth";

const STORE_USER_RE = /^store\d{3}@unze\.co\.uk$/i;

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  let storeId = searchParams.get("store_id");
  const year    = parseInt(searchParams.get("year")  ?? "", 10);
  const month   = parseInt(searchParams.get("month") ?? "", 10);

  if (!storeId || !year || !month || month < 1 || month > 12) {
    return Response.json({ error: "store_id, year, month required" }, { status: 400 });
  }

  const authHeader = request.headers.get("authorization") ?? "";

  // Build the caller's Supabase client so that RLS (security_invoker view) uses
  // their session — the view filters by has_widget OR own store.
  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } }
  );

  // Detect store users (by email pattern OR future app_metadata — RPC is the
  // authoritative check). For non-widget users, derive store server-side and
  // override the query param so the client can never read another store's rows.
  const isStoreUserByEmail = auth.email ? STORE_USER_RE.test(auth.email) : false;

  if (isStoreUserByEmail) {
    // Derive the authoritative store_id from the DB
    const { data: derivedStoreId, error: rpcError } = await userClient.rpc("retail_store_for_user");

    if (rpcError) {
      console.error("[daily-sales/rows] retail_store_for_user RPC error:", rpcError);
      return Response.json({ error: rpcError.message }, { status: 500 });
    }

    if (!derivedStoreId) {
      return Response.json({ rows: [] });
    }

    // Override whatever the client sent — server wins
    storeId = derivedStoreId as string;
  }

  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth  = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  const { data, error } = await userClient
    .from("daily_sales_computed")
    .select("*")
    .eq("store_id", storeId)
    .gte("sales_date", monthStart)
    .lt("sales_date", nextMonth)
    .order("sales_date", { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ rows: data ?? [] });
}
