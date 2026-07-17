-- Notification preferences per user
ALTER TABLE members ADD COLUMN IF NOT EXISTS notif_task_assigned boolean DEFAULT true;
ALTER TABLE members ADD COLUMN IF NOT EXISTS notif_task_overdue boolean DEFAULT true;
ALTER TABLE members ADD COLUMN IF NOT EXISTS notif_escalations boolean DEFAULT true;
ALTER TABLE members ADD COLUMN IF NOT EXISTS notif_meetings boolean DEFAULT true;
ALTER TABLE members ADD COLUMN IF NOT EXISTS notif_daily_digest boolean DEFAULT true;
ALTER TABLE members ADD COLUMN IF NOT EXISTS notif_weekly_report boolean DEFAULT true;
