-- Performance indexes for the most-queried columns.
-- Run this in the Supabase SQL Editor.

-- Ops entries: queried heavily by entry_date range on every dashboard load
create index if not exists idx_production_entries_date   on production_entries(entry_date);
create index if not exists idx_dispatch_entries_date     on dispatch_entries(entry_date);
create index if not exists idx_breakage_entries_date     on breakage_entries(entry_date);
create index if not exists idx_scrap_entries_date        on scrap_processed_entries(entry_date);

-- Ops entries: also filtered by plant_id inside the date range
create index if not exists idx_production_entries_plant  on production_entries(plant_id, entry_date);
create index if not exists idx_dispatch_entries_plant    on dispatch_entries(plant_id, entry_date);
create index if not exists idx_breakage_entries_plant    on breakage_entries(plant_id, entry_date);

-- Tasks: filtered by status, assigned_to_email, due_date, and department constantly
create index if not exists idx_tasks_status              on tasks(status);
create index if not exists idx_tasks_assigned_email      on tasks(assigned_to_email);
create index if not exists idx_tasks_due_date            on tasks(due_date);
create index if not exists idx_tasks_department          on tasks(assigned_to_department);
create index if not exists idx_tasks_source              on tasks(source_type, source_label);

-- Cash positions: queried by company + date on every finance load
create index if not exists idx_cash_pos_company_date     on daily_cash_position(company_id, position_date desc);

-- Receivables: filtered by status constantly
create index if not exists idx_receivables_status        on receivables(status);

-- Machine issues: filtered by issue_status
create index if not exists idx_machine_issues_status     on machine_issues(issue_status);

-- Audit log: filtered by user_email on home page member view
create index if not exists idx_audit_log_user_email      on audit_log(user_email, created_at desc);
