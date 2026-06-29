import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";

const TABLES_TO_WIPE = [
  "meeting_tasks",
  "meeting_attendees",
  "meeting_requests",
  "pending_minutes",
  "meetings",
  "tasks",
  "recurring_tasks",
  "daily_cash_position",
  "bank_position_snapshots",
  "cash_opening_balance",
  "opening_balances",
  "broken_opening_balances",
  "monthly_budgets",
  "monthly_cash_plan",
  "quarterly_forecasts",
  "department_budgets",
  "monthly_dispatch_targets",
  "monthly_production_targets",
  "production_entries",
  "dispatch_entries",
  "breakage_entries",
  "scrap_processed_entries",
  "machine_issues",
  "receivables",
  "holdings",
  "price_history",
  "legal_notices",
  "audit_plan_items",
  "audit_log",
  "notification_log",
  "recruitment_positions",
];

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  if (body.confirm !== "GO_LIVE_WIPE") {
    return Response.json({ error: "Send { confirm: 'GO_LIVE_WIPE' } to proceed" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const results: { table: string; status: string; deleted?: number }[] = [];

  const SPECIAL_DELETES: Record<string, string> = {
    meeting_tasks: "meeting_id",
    current_prices: "symbol",
  };

  for (const table of TABLES_TO_WIPE) {
    try {
      const col = SPECIAL_DELETES[table] || "id";
      const { count, error } = await supabase
        .from(table)
        .delete({ count: "exact" })
        .neq(col, "00000000-0000-0000-0000-000000000000");

      if (error) {
        results.push({ table, status: `error: ${error.message}` });
      } else {
        results.push({ table, status: "wiped", deleted: count ?? 0 });
      }
    } catch (e) {
      results.push({ table, status: `exception: ${e instanceof Error ? e.message : "unknown"}` });
    }
  }

  return Response.json({ ok: true, message: "Go-live data wipe complete", results });
}
