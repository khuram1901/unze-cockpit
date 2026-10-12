/**
 * POST /api/daily-sales/import-preview
 * Body: { store_id, year, month, rows: NormalisedRow[] }
 *
 * rows must already be normalised (snake_case keys, ISO sales_date).
 * ExcelImportPanel.normalizeRow() handles this on the client.
 *
 * Returns: { preview: PreviewRow[], batch_id: string, errors: [], warnings: [] }
 */
import { NextRequest } from "next/server";
import { createClient }  from "@supabase/supabase-js";
import { requireAuth }   from "../../../lib/api-auth";

interface RpcValid   { row: number; sales_date: string; will_replace: boolean; }
interface RpcError   { row: number; sales_date: string; error: string; }
interface RpcWarning { row: number; sales_date: string; warning: string; }
interface RpcResult  {
  store_name: string;
  row_count:  number;
  valid:      RpcValid[];
  errors:     RpcError[];
  warnings:   RpcWarning[];
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const body = await request.json() as {
    store_id: string;
    year:     number;
    month:    number;
    rows:     Record<string, unknown>[];
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

  // Generate a batch ID — passed back to the client and forwarded to import_confirm
  const batchId = crypto.randomUUID();

  const { data, error } = await uc.rpc("import_preview", {
    p_store_id: body.store_id,
    p_rows:     body.rows,
  });

  if (error) {
    const status = error.message.includes("requires the imperial.retail_sales widget") ? 403 : 500;
    return Response.json({ error: error.message }, { status });
  }

  const result = data as RpcResult;

  // Build the PreviewRow[] the client table expects.
  // Only valid rows appear in the preview; errors are shown separately.
  const preview = result.valid.map((v: RpcValid) => {
    const row = body.rows[v.row - 1] as Record<string, unknown>; // row is 1-based
    return {
      sales_date:           String(row.sales_date   ?? ""),
      cash_sale:            Number(row.cash_sale    ?? 0),
      campaign_float_cash:  Number(row.campaign_float_cash ?? 0),
      expenses:             Number(row.expenses     ?? 0),
      other_income:         Number(row.other_income ?? 0),
      deposit:              Number(row.deposit      ?? 0),
      allied_bank_cc_sale:  Number(row.allied_bank_cc_sale ?? 0),
      hbl_cc_sale:          Number(row.hbl_cc_sale  ?? 0),
      gift_karte:           Number(row.gift_karte   ?? 0),
      gift_vouchers:        Number(row.gift_vouchers ?? 0),
      credit_notes_issue:   Number(row.credit_notes_issue ?? 0),
      remarks:              row.remarks != null ? String(row.remarks) : null,
      conflict:             v.will_replace,
      conflict_reason:      v.will_replace ? "Existing row will be replaced" : null,
    };
  });

  return Response.json({
    preview,
    batch_id:   batchId,
    store_name: result.store_name,
    errors:     result.errors,
    warnings:   result.warnings,
  });
}
