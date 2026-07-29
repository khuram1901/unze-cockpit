import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { parseCashFlowForecast } from "../../../lib/excel-parsers/cash-flow-forecast-parser";
import { UTPL_COMPANY_ID } from "../../../lib/constants";
import { requireAuth } from "../../../lib/api-auth";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const companyId = (formData.get("companyId") as string) || UTPL_COMPANY_ID;

    if (!file) {
      return Response.json({ error: "Excel file is required." }, { status: 400 });
    }

    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
    if (file.size > MAX_FILE_SIZE) {
      return Response.json({ error: "File exceeds 10 MB limit." }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseCashFlowForecast(buffer);

    const supabase = createServiceClient();

    // ── Record the upload + its calculation checks (permanent log) ──
    const checksPassed = parsed.checks.filter((c) => c.passed).length;
    const checksFailed = parsed.checks.filter((c) => !c.passed && c.blocking).length;
    const warnings = parsed.checks.filter((c) => !c.passed && !c.blocking).length;
    const { data: uploadLog } = await supabase
      .from("forecast_uploads")
      .insert({
        company_id: companyId,
        file_name: file.name.slice(0, 200),
        status: parsed.accepted ? "accepted" : "rejected",
        months: parsed.months.length,
        categories: parsed.rows.length,
        checks_passed: checksPassed,
        checks_failed: checksFailed,
        warnings,
        uploaded_by: auth.email,
      })
      .select("id")
      .single();
    if (uploadLog) {
      await supabase.from("forecast_upload_checks").insert(
        parsed.checks.map((c) => ({
          upload_id: uploadLog.id,
          check_name: c.name.slice(0, 200),
          expected: Number.isFinite(c.expected) ? c.expected : null,
          reported: Number.isFinite(c.reported) ? c.reported : null,
          diff: Number.isFinite(c.diff) ? c.diff : null,
          passed: c.passed,
          blocking: c.blocking,
        })),
      );
    }

    // An internally inconsistent file never reaches the dashboard: if the
    // file's own totals disagree with the sum of their lines, reject.
    if (!parsed.accepted) {
      return Response.json({
        error: `The file's own calculations don't add up — ${checksFailed} check${checksFailed > 1 ? "s" : ""} failed. Nothing was saved.`,
        checks: parsed.checks,
      }, { status: 422 });
    }

    // Flatten into monthly_budgets rows
    const upsertRows = parsed.rows.flatMap((row) =>
      row.months.map((m) => ({
        company_id: companyId,
        budget_month: m.month,
        flow_type: row.flowType,
        category: row.category,
        budgeted_amount: m.amount,
        uploaded_by: auth.email,
      }))
    );

    if (upsertRows.length === 0) {
      return Response.json({ error: "No data found in the Excel file." }, { status: 400 });
    }

    // REPLACE semantics (29/07/2026): an upload IS the forecast for its
    // months. The old upsert-only behaviour left stale categories from
    // previous files in place (found live: a bug-era "NET CASH FLOW" row
    // and dropped categories still counting in the totals). Clearing the
    // uploaded months first means renamed/removed lines disappear too.
    for (const month of parsed.months) {
      await supabase.from("monthly_budgets").delete().eq("company_id", companyId).eq("budget_month", month);
    }

    const { error } = await supabase
      .from("monthly_budgets")
      .upsert(upsertRows, { onConflict: "company_id,budget_month,category" });

    if (error) {
      return Response.json({ error: "Failed to save: " + error.message }, { status: 500 });
    }

    // Also aggregate into quarterly_forecasts
    const quarterMap = new Map<string, { flowType: string; category: string; total: number }>();
    for (const row of upsertRows) {
      const [year, month] = row.budget_month.split("-");
      const q = Math.ceil(Number(month) / 3);
      const quarter = `${year}-Q${q}`;
      const key = `${quarter}:${row.category}`;
      const existing = quarterMap.get(key);
      if (existing) {
        existing.total += row.budgeted_amount;
      } else {
        quarterMap.set(key, { flowType: row.flow_type, category: row.category, total: row.budgeted_amount });
      }
    }

    const quarterRows = Array.from(quarterMap.entries()).map(([key, val]) => ({
      company_id: companyId,
      forecast_quarter: key.split(":")[0],
      flow_type: val.flowType,
      category: val.category,
      forecast_amount: val.total,
      uploaded_by: auth.email,
    }));

    if (quarterRows.length > 0) {
      // Same replace semantics for the quarters this file touches.
      for (const quarter of new Set(quarterRows.map((q) => q.forecast_quarter))) {
        await supabase.from("quarterly_forecasts").delete().eq("company_id", companyId).eq("forecast_quarter", quarter);
      }
      await supabase
        .from("quarterly_forecasts")
        .upsert(quarterRows, { onConflict: "company_id,forecast_quarter,category" });
    }

    return Response.json({
      success: true,
      sheetName: parsed.sheetName,
      months: parsed.months,
      categories: parsed.rows.length,
      totalRows: upsertRows.length,
      quarterRows: quarterRows.length,
      checks: parsed.checks,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: "Parse failed: " + message }, { status: 500 });
  }
}
