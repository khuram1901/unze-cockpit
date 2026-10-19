# Audit page (`/department/audit`) — Decisions

Source of truth for the Annual Internal Audit Plan page. Created 19/10/2026 from the page audit + fix session (migration 280).

## Purpose (Khuram, 19/10/2026)
- The Internal Audit team's working page: annual plan per team (Unze, Imperial, Restaurants), stage tasks per process, where teams are stuck, and the daily approvals check recorded by the pre-audit team.
- Users had been complaining the page showed nothing. Root cause: the department was renamed "Audit" → "Internal Audit" on 18/10 and every database rule still checked the old name. No data was lost.

## Access
- **Who sees the page:** department "Internal Audit" (legacy "Audit" still accepted), Admin/Exec, or the Access Matrix override `can_view_dept_audit`. Database helper `is_internal_audit_member()` mirrors this on every audit table policy and RPC.
- **Manager rights** (`is_audit_manager()`): Admin/Exec, or role Manager in Internal Audit (Shahid). Managers see all teams, the stuck strip, the week sparkline, and can assign members to teams.
- **Members** see only their own team's processes; the member banner names the team and companies.
- **Daily approvals check:** any Pre-audit team member (`is_pre_audit_member()`), any manager, or a member explicitly assigned to an activity may save counts for that company. Assignment is optional — a member with no assignments sees all 14 activities; once assigned, their list narrows automatically.
- Test accounts are excluded from the manager's "assign member" list. test.member / test.manager (Executive Office) are refused by the database (`not_authorised`).

## Rules
- **Every figure comes from Postgres** (`audit_team_overview`, `audit_daily_log_summary`, `audit_my_tasks`, `audit_executive_summary`). The page filters already-returned rows by team for display only.
- **Dates:** "today" is the Pakistan date on both sides — the page via `toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" })`, the RPC via `(now() at time zone 'Asia/Karachi')::date` (the database runs in UTC). The daily log row is saved against the RPC's `as_of` date so the two can never disagree.
- **Fiscal year label** is computed from the date (1 Jul → 30 Jun), never hard-coded.
- **Errors are shown, not swallowed:** "You don't have access…" when the database refuses, "Could not load…" with a Try again button on any other failure.
- **Confirmations** (delete step, delete project, start new cycle) use an in-page amber bar — never `window.confirm`.
- Colours only from `SharedUI` (`INFO_SOFT`, `DANGER_SOFT`, `WARNING_SOFT`, `PURPLE`).
- Widgets: `dept_audit.stuck_strip` and the other `dept_audit.*` keys are unchanged.

## Migrations
280 (`supabase/280_audit_page_access.sql`): helpers `is_internal_audit_member`, `is_pre_audit_member`; `is_audit_manager` / `is_assigned_audit_company` re-pointed; 10 policies ALTERed (no drops); 5 RPCs re-pointed; daily summary uses the PKT date. Rollback notes in the file. Applied to production 19/10/2026 before the code shipped, so the team regained access immediately.

## Open items
- The page has an `assignDailyTask` function but no control calls it, so activities cannot be assigned to members from the UI (all 14 are unassigned). Assignment is optional now; add the control if Shahid wants per-member scoping.
- The Pre-audit team has no companies in `audit_team_companies`; its members are matched to processes by name in `responsible`. Fine today; fragile if names change.
- `audit_daily_log_summary` last real entry was 21/07/2026 — expect the team to resume now that saving works.
- Verify the home Audit cards (`AuditProgressCard`, `PreauditApprovalsCard`) and the Tasks panel for a member after deploy (same RPCs, so should be fixed by migration alone).
