-- Migration 037: Add indexes on heavily queried columns
-- These tables are queried on every page load but had no indexes

-- Tasks (most queried table in the app)
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_email ON tasks(assigned_to_email);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by ON tasks(assigned_by);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_department ON tasks(assigned_to_department);

-- Production/Dispatch/Breakage entries (date range queries on every dashboard load)
CREATE INDEX IF NOT EXISTS idx_production_entries_date ON production_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_dispatch_entries_date ON dispatch_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_breakage_entries_date ON breakage_entries(entry_date);

-- Machine issues (filtered by status for "down" machines)
CREATE INDEX IF NOT EXISTS idx_machine_issues_status ON machine_issues(issue_status);

-- Receivables (filtered by status and stage on receivables page)
CREATE INDEX IF NOT EXISTS idx_receivables_status ON receivables(status);
CREATE INDEX IF NOT EXISTS idx_receivables_stage ON receivables(current_stage_order);

-- Meetings (filtered by date for upcoming meetings)
CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(meeting_date);

-- Members email (used by every RLS function and permission check)
CREATE INDEX IF NOT EXISTS idx_members_email ON members(email);

-- Member permissions (joined by member_id in every RLS check)
CREATE INDEX IF NOT EXISTS idx_member_permissions_member_id ON member_permissions(member_id);

-- Legal department permission column (separates Legal from Tax)
ALTER TABLE member_permissions ADD COLUMN IF NOT EXISTS can_view_dept_legal boolean;
