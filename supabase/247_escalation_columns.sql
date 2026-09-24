-- Migration 247: Escalation columns
-- Adds due_time (specific time-of-day), escalation_exempt, and Critical priority support.
-- The get_my_escalated_tasks() RPC (migration 248) uses these columns to surface
-- overdue tasks to the relevant manager / HOD / Director at the right escalation level.
--
-- Active priority model (all thresholds are L1 / L2 / L3):
--   Critical  →  6 h / 12 h /  60 h
--   Urgent    → 24 h / 48 h / 120 h
--   Normal    → 48 h / 96 h / 216 h
--   Low       → no escalation
--
-- Retired labels (never stored by createTaskCore, normalised at last line of defence):
--   Medium → Normal   (maps to Normal tier)
--   High   → Urgent   (maps to Urgent tier)
--
-- escalation_exempt: set true by a CEO/Admin to exclude one-off tasks from escalation.
-- due_time on tasks: optional HH:MM time component when a task must be done by a specific hour.
-- due_time on recurring_tasks: same, carried forward when the cron spawns a new task.

begin;

alter table public.tasks
  add column if not exists due_time     time     default null,
  add column if not exists escalation_exempt boolean not null default false;

alter table public.recurring_tasks
  add column if not exists due_time time default null;

commit;
