/**
 * POST /api/daily-sales/import-preview
 * Body: { store_id: string, rows: Record<string, unknown>[] }
 *
 * Calls import_preview() RPC — returns preview rows with conflict flags.
 * RPC requires has_widget('imperial.retail_sales') internally.
 *
 * Test only with BEGIN … ROLLBACK; never auto-commits data.
 */
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../lib/api-auth";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const body = await request.json() as {
    store_id: string;
    rows: Record<string, unknown>[];
  };

  if (!body.store_id || !Array.isArray(body.rows)) {
    return Response.json({ error: "store_id and rows array required" }, { status: 400 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const uc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data, error } = await uc.rpc("import_preview", {
    p_store_id: body.store_id,
    p_rows:     body.rows,
  });

  if (error) {
    const status = error.message.includes("requires the imperial.retail_sales widget") ? 403 : 500;
    return Response.json({ error: error.message }, { status });
  }

  return Response.json({ preview: data });
}
