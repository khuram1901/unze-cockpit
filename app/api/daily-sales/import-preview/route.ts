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
    store_id:  string;
    year:      number;
    month:     number;
    file_name: string;
    rows:      Record<string, unknown>[];
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

  // Filter rows to only those that fall within the selected year/month.
  // The LDS Excel file contains an opening-balance row dated the last day of
  // the PREVIOUS month (e.g. 2026-07-31 when importing August). Sending that
  // row to the RPC triggers a lock-check on the wrong month, so we strip it
  // here before the RPC ever sees it.
  const filteredRows = (body.rows as Record<string, unknown>[]).filter(row => {
    const ds = String(row.sales_date ?? "");
    if (!ds) return false;
    const d = new Date(ds);
    if (isNaN(d.getTime())) return false;
    return d.getUTCFullYear() === body.year && (d.getUTCMonth() + 1) === body.month;
  });

  if (filteredRows.length === 0) {
    return Response.json({
      preview:    [],
      batch_id:   crypto.randomUUID(),
      store_name: "",
      errors:     [{ row: 0, sales_date: "", error: `No rows found for \${body.year}-\${String(body.month).padStart(2,"0")}` }],
      warnings:   [],
    });
  }

  // Get the authenticated user's ID for import_batches.imported_by
  const { data: { user } } = await uc.auth.getUser();
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await uc.rpc("import_preview", {
    p_store_id: body.store_id,
    p_rows:     filteredRows,
  });

  if (error) {
    const status = error.message.includes("requires the imperial.retail_sales widget") ? 403 : 500;
    return Response.json({ error: error.message }, { status });
  }

  const result = data as RpcResult;

  // Create the import_batches record so daily_sales FK is satisfied on confirm.
  // Must use service-role client here — import_batches has no INSERT RLS policy
  // for authenticated users, so the anon-key+JWT client is silently blocked.
  const sc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const batchId = crypto.randomUUID();
  const yearMonth = `${body.year}-${String(body.month).padStart(2, "0")}-01`;
  const { error: batchErr } = await sc
    .from("import_batches")
    .insert({
      id:          batchId,
      store_id:    body.store_id,
      year_month:  yearMonth,
      file_name:   body.file_name || "unknown.xlsx",
      row_count:   result.valid?.length ?? 0,
      status:      "pending",
      imported_by: user.id,
    });
  if (batchErr) {
    console.error("import_batches insert failed:", batchErr.message);
    return Response.json({ error: `Failed to create import batch: ${batchErr.message}` }, { status: 500 });
  }

  // Build the PreviewRow[] the client table expects.
  // Only valid rows appear in the preview; errors are shown separately.
  const preview = result.valid.map((v: RpcValid) => {
    const row = filteredRows[v.row - 1] as Record<string, unknown>; // v.row is 1-based index into filteredRows sent to RPC
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
