import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env.local");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const TABLES = [
  "companies", "members", "member_plants", "plants",
  "department_owners", "tasks", "meeting_requests",
  "production_entries", "dispatch_entries", "breakage_entries",
  "scrap_processed_entries", "machine_issues",
  "opening_balances", "broken_opening_balances",
  "monthly_production_targets", "monthly_dispatch_targets",
  "daily_cash_position", "monthly_cash_plan", "cash_opening_balance",
  "bank_position_snapshots", "receivables", "receivable_stages",
  "audit_plan_items", "audit_findings",
  "recruitment_positions", "performance_evaluations", "hr_strategy_goals",
  "legal_notices", "admin_categories", "admin_spend",
  "meetings", "meeting_tasks", "meeting_attendees", "monthly_budgets", "quarterly_forecasts",
  "audit_log", "notification_log",
  "department_budgets", "member_permissions", "recurring_tasks",
  "holdings", "price_history", "pending_minutes", "push_subscriptions",
];

const backup = {};
let totalRows = 0;
for (const table of TABLES) {
  const { data, error } = await supabase.from(table).select("*");
  if (error) {
    console.error(`FAILED: ${table} — ${error.message}`);
    backup[table] = { error: error.message };
    continue;
  }
  backup[table] = data || [];
  totalRows += data?.length || 0;
  console.log(`${table}: ${data?.length || 0} rows`);
}

const today = new Date().toISOString().slice(0, 10);
const outDir = path.join(__dirname, "..", "backups");
mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `cockpit-backup-${today}.json`);
writeFileSync(outPath, JSON.stringify(backup, null, 2));

console.log(`\nSaved ${Object.keys(backup).length} tables, ${totalRows} total rows to ${outPath}`);
