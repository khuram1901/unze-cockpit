# Task & Notification System Audit

Synopsis only — no code changed. Purpose: give Khuram a full picture of how notifications and task assignment currently work, so he can set the "golden rules" for a follow-up cleanup.

---

## Part 1 — Notifications

**Good news first: this side is already centralised.** There is exactly one function that sends email, `sendNotificationEmail()` in `app/lib/send-email.ts`. Every part of the app that wants to notify someone calls this same function — nobody is sending email a second, competing way.

**How it works:**
- Only channel is email, sent via the Gmail API (your Gmail account is the sender, OAuth token stored in `google_oauth_tokens`, auto-refreshed).
- Every send is logged to `notification_log` (recipient, subject, trigger type, status) — a full audit trail already exists.
- Each email carries a `triggerType` string. There are 14 in use today:

| Trigger type | Where it's fired |
|---|---|
| `task_assigned` | `/api/notifications/send` (used by NewTaskForm, PA quick-add, meeting minutes, my-minutes, recurring cron) |
| `escalation` | `/api/notifications/send` |
| `daily_digest` | `/api/notifications/digest` (5am admin/exec digest) |
| `daily_report` | `/api/reports/daily-pdf` |
| `weekly_report` | `/api/reports/weekly` |
| `monthly_po_report` | `/api/reports/monthly-po` |
| `investment_daily_summary` | `/api/investments/daily-summary` |
| `tax_deadline_alert` | `app/lib/taxAlertEngine.ts` (2 call sites) |
| `ceo_daily_digest` | `/api/notifications/ceo-digest` |
| `dispatch_notification` | `/api/stock/dispatch-records` |
| `welcome_invite` | `/api/members/invite` |
| `password_reset` | `/api/auth/reset-password` |
| `password_changed` | `/api/notifications/password-changed` |
| `meeting_minutes` | `/api/meetings/send-minutes` |

- **Suppression for you specifically:** a hardcoded list (`DIGEST_COVERED_TRIGGER_TYPES`) silently blocks 8 of those trigger types from emailing `k.saleem@unzegroup.com` / `khuram1901@gmail.com`, because you now get everything folded into the CEO daily digest instead. Everyone else on those same emails (PA, ops managers, Shakeel, etc.) still gets every individual email exactly as before. This was built deliberately in an earlier session — it is working as intended, not a bug.

- **Automation driving all this** — 19 cron jobs in `vercel.json`, spanning finance/meeting inbox checks (every 10 min), the digests, recurring task generation, investment price updates (3x on weekdays), tax alerts, weekly/monthly reports, nightly backup, and Folderit sync (every 30 min).

**Where I'd flag a risk, not a bug:** trigger types are just free-text strings typed out at each call site — there's no shared constant/enum. If someone adds a new notification later and mistypes the string (or picks a new one), it silently won't be covered by the digest-suppression list and you'll start getting a stray individual email again. Small risk today, but worth a rule once you're setting standards.

---

## Part 2 — Task creation & assignment

**This is where the real inconsistency lives.** There are **7 separate places** in the codebase that insert a new row into the `tasks` table, and none of them share a common function. Each one was built independently, at a different time, so each one populates a different subset of fields.

| Creation path | company_id | Department source | Char limit | `assigned_by` | Notifies assignee? |
|---|---|---|---|---|---|
| **New Task form** (`tasks/NewTaskForm.tsx`) — the main manual path | ✅ required in UI | member record, falls back to project | ✅ 150 chars | ✅ real logged-in user | ✅ |
| **PA quick-add** (`pa/page.tsx`) | ❌ none | member record only | ❌ none | ✅ real user | ✅ |
| **Meeting minutes — manual add** (`my-minutes/page.tsx`) | ❌ none | member record only | ❌ none | ⚠️ hardcoded `"Meeting Minutes"` | ✅ |
| **Meeting minutes — AI extraction** (`meetings/page.tsx`) | ❌ none | AI-guessed / typed | ❌ none | ⚠️ hardcoded `"Meeting Minutes"` | ✅ |
| **CSV bulk import** (`tasks/TasksList.tsx`) | ❌ none | typed CSV cell, unvalidated | ❌ none | ⚠️ raw CSV cell, unvalidated | ❌ none |
| **Recurring task cron** (`api/tasks/recurring/route.ts`) | ❌ none | copied from template | ❌ none | ⚠️ hardcoded `"Recurring Task"` fallback | ✅ |
| **Auto-escalation ×3** (`home/page.tsx` — KPI, receivables, cash) | ❌ none | hardcoded (`"Unze Trading Ops"` / `"Finance"`) | n/a (system text) | ⚠️ hardcoded `"System"` | ❌ **none** |

**Specific conflicts worth your attention:**

1. **Company tagging is inconsistent.** Only the main New Task form requires and stores `company_id`. All 6 other paths leave it blank. If you're relying on company_id anywhere for filtering (UTPL vs IFPL), tasks created by PA, meeting minutes, CSV import, recurring jobs, or auto-escalation will never show up correctly tagged.

2. **`assigned_by` is sometimes a real person, sometimes a fixed label.** Meeting-sourced tasks always say "Meeting Minutes" as the assigner — even though a real person ran the extraction or added the task. Auto-escalation tasks always say "System." CSV import takes whatever text was typed in the spreadsheet, unchecked. This makes "who assigned this" unreliable as a field across the app.

3. **The 150-character description limit only exists in one of seven paths** (New Task form). Everywhere else — PA, meeting minutes, CSV import, recurring, auto-escalation — a paragraph-length description can still get in.

4. **Three task types are created with zero notification at all**: the KPI escalation, receivables escalation, and cash escalation auto-tasks in `home/page.tsx` insert directly into `tasks` and never call the notification endpoint. The assignee finds out only if they happen to open the dashboard and see it — there's no email nudging them. CSV-imported tasks are the same: silent, no notification fired.

5. **Department is resolved differently depending on path** — sometimes pulled from the person's member record, sometimes from a manually typed "project" field, sometimes hardcoded to a fixed string like "Unze Trading Ops" or "Finance" regardless of who's actually assigned.

6. **Duplicate-prevention for auto-created escalations is client-side, not database-enforced.** The three `home/page.tsx` functions check "does a task with this `source_type` + `source_label` already exist?" against the list of tasks already loaded into the browser. It works in practice, but it's a soft check, not a hard constraint — two people loading the executive dashboard at the same moment could theoretically both pass the check before either insert lands.

7. **Minor performance note** (not a conflict, just noticed while reading): the meeting-minutes AI-extraction loop calls `supabase.auth.getUser()` once per action item instead of once before the loop. Harmless today, but wasteful if a meeting has many action items.

---

## What's *not* broken

- Notification sending itself: one function, one audit log, working suppression logic. No duplicate email pathways.
- The New Task form is a solid model of what "done right" looks like — company required, character limit, real assigner, subtask support, department resolution from the actual person record.

The core problem isn't the notification system — it's that task **creation** has 7 independent, unaligned entry points, and the New Task form is the only one that follows every rule you'd probably want followed everywhere.

---

Ready for your golden rules whenever you want to go through this — happy to turn whatever you decide into a shared task-creation helper so all 7 paths (and any future ones) go through the same gate.
