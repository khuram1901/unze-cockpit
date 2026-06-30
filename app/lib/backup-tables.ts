// Single source of truth for which tables are included in the nightly
// backup and restorable via /api/admin/restore. Keep these two routes
// in sync — a table missing here is invisible to both backup and restore.
export const BACKUP_TABLES = [
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
  "document_archive",
];
