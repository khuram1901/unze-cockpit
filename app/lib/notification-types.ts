// Centralised trigger-type constants for task-related notification emails.
//
// Scope: this covers the two trigger types fired by task creation/
// assignment (task_assigned, escalation) — the ones directly involved in
// the task-creation consolidation agreed with Khuram (see
// TASK_NOTIFICATION_AUDIT.md). Other trigger types used elsewhere in the
// app (daily_digest, tax_deadline_alert, weekly_report, etc. — see the
// DIGEST_COVERED_TRIGGER_TYPES list in send-email.ts) are unrelated to
// task creation and were deliberately left as free-typed strings for now;
// widening this file to cover them is a separate future cleanup.
//
// Using these constants instead of retyping the string at every call site
// means a typo can never quietly create a new, unsuppressed trigger type
// that slips past the CEO-digest suppression list in send-email.ts.
export const TRIGGER_TASK_ASSIGNED = "task_assigned";
export const TRIGGER_ESCALATION = "escalation";
// Fired when a task is moved to "Submitted" — sent to the HOD/manager
// who now owns the task and must sign it off. Not suppressed for the CEO
// digest recipients because the CEO's tasks are generally not routed to
// themselves; this fires to the *manager*, not the submitter.
export const TRIGGER_TASK_SUBMITTED = "task_submitted";
