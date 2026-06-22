import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { parseCashFlowForecast } from "../../../lib/excel-parsers/cash-flow-forecast-parser";
import { UTPL_COMPANY_ID } from "../../../lib/constants";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const companyId = (formData.get("companyId") as string) || UTPL_COMPANY_ID;

    if (!file) {
      return Response.json({ error: "Excel file is required." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseCashFlowForecast(buffer);

    const supabase = createServiceClient();

    // Flatten into monthly_budgets rows
    const upsertRows = parsed.rows.flatMap((row) =>
      row.months.map((m) => ({
        company_id: companyId,
        budget_month: m.month,
        flow_type: row.flowType,
        category: row.category,
        budgeted_amount: m.amount,
        uploaded_by: (formData.get("uploadedBy") as string) || "manual",
      }))
    );

    if (upsertRows.length === 0) {
      return Response.json({ error: "No data found in the Excel file." }, { status: 400 });
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
      uploaded_by: (formData.get("uploadedBy") as string) || "manual",
    }));

    if (quarterRows.length > 0) {
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
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: "Parse failed: " + message }, { status: 500 });
  }
}
