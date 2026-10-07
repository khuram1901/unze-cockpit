/**
 * GET /api/daily-sales/rows?store_id=<uuid>&year=2026&month=9
 *
 * Returns all rows from daily_sales_computed for a given store + month.
 * Requires either:
 *   - has_widget('imperial.retail_sales')  — Finance Manager / HOD view
 *   - can_access_daily_sales = true in member_permissions — store user (own store only)
 *
 * The view itself enforces RLS (security_invoker = true), so the Supabase
 * anon-key client is used here and the DB applies the caller's policies.
 * We call it with the user's own JWT so RLS runs as the authenticated user.
 */
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("store_id");
  const year    = parseInt(searchParams.get("year")  ?? "", 10);
  const month   = parseInt(searchParams.get("month") ?? "", 10);

  if (!storeId || !year || !month || month < 1 || month > 12) {
    return Response.json({ error: "store_id, year, month required" }, { status: 400 });
  }

  // Build the caller's Supabase client so that RLS (security_invoker view) uses
  // their session — the view filters by has_widget OR own store.
  const authHeader = request.headers.get("authorization") ?? "";
  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } }
  );

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
