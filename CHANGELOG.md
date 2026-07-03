# Changelog — Unze Group Dashboard

Most recent entry at the top. **Append-only — never delete or edit old entries.**

---

## 2026-07-03 (session continued 4) — Meetings sort order fix

- `app/meetings/page.tsx` — when grouped by department, month groups were sorted oldest-first (a→z). Fixed to newest-first (b→a), matching the date-grouped view.

---

## 2026-07-03 (session continued 3) — Custom DateInput component, all date pickers replaced

**What changed:**
- Built `app/lib/DateInput.tsx` — custom text input that shows and accepts DD/MM/YYYY, auto-inserts slashes as you type, validates on blur with red border, and calls onChange with YYYY-MM-DD so all DB code is unchanged.
- Root cause: Safari ignores `lang="en-GB"` for native `<input type="date">` and always shows MM/DD/YYYY regardless. The custom component bypasses this entirely.
- Replaced all 29 native date inputs across 14 files: tasks, receivables, PA dashboard, home page, executive page, daily entry, receivables section, calendar, meetings, my-minutes, finance, opening balances, stock manage, investments, HR/Audit/Taxation department dashboards.
- Rule added to CLAUDE.md: never use `<input type="date">` again — always use `<DateInput>` from `app/lib/DateInput.tsx`.

---

## 2026-07-03 (session continued 2) — DD/MM/YYYY date pickers fixed globally

**Root cause identified and fixed:**
- All `<input type="date">` fields were showing MM/DD/YYYY because the root HTML element had `lang="en"` (American English). Changed to `lang="en-GB"` in `app/layout.tsx`. One line, fixes every date picker across the entire app — tasks, receivables, finance, stock, production, meetings, calendar, investments.

---

## 2026-07-03 (session continued) — Data retention + UX tidying

**What changed:**
- **90-day window anchored to selected date** (`home/page.tsx`, `executive/page.tsx`) — when viewing a past date, the ops entry query window now extends 90 days before *that date*, not before today. Means you can view any date in history without the production/dispatch context being cut off.
- **Daily entry PO dropdown** (`production/ProductionForm.tsx`) — replaced stacked PO selection buttons with a compact `<select>` dropdown. Tidier, especially when multiple POs exist.
- All data is retained indefinitely in the database. No automatic deletion anywhere.

---

## 2026-07-03 — Historical date selector: investments, cash, and date format enforcement

**What changed:**

- **Investment portfolio now respects selected date** — when changing the date on the CEO home page, the portfolio value shown is calculated using the price recorded in `price_history` on or before that date (most recent price available). Previously it always showed today's value regardless of the date selected.
- **Cash positions now respect selected date** — `daily_cash_position` now filtered `<= selectedDate` so the finance section shows the cash balance as it stood on the selected day.
- **Cash plan and budget month** now derived from `selectedDate` (not today) — plan context matches the month being viewed.
- **DD/MM/YYYY date format enforced globally** — fixed 6 locations where raw `YYYY-MM-DD` database strings were rendered directly (attention items, investment price date, search results meeting dates, and two email API routes). Rule added permanently to `CLAUDE.md` and `dateUtils.ts`.

**Performance improvements (from previous session):**
- `app/home/page.tsx`: sessionStorage cache (2-min TTL, per date key), 90-day floor on unbounded ops queries, explicit column lists, parallelised dept health checks
- `app/dashboard/DashboardView.tsx`: 90-day floor, explicit column lists, task limit 200
- `app/executive/page.tsx`: same 90-day floor + column trims
- `app/pa/page.tsx`: explicit column lists, meeting query trimmed
- `app/lib/AuthWrapper.tsx`: global search cache — fetch once per session, filter in memory
- `supabase/053_performance_indexes.sql`: 13 DB indexes applied (entry_date, status, assigned_to_email, company_id, position_date, etc.)

**Database changes:** Migration 053 (performance indexes) — applied manually.

---

## 2026-07-02 (session 2) — Bug fixes: edit permissions, receivables, Gmail inbox

**Bugs fixed:**
- Ops Managers (Asif, Usman, Yahya) couldn't delete production/dispatch/breakage entries — `canDelete` was hardcoded to Nadeem only; `ProductionForm` also wasn't fetching `department` so `canAccessDailyEntry` always failed for ops managers
- `canEditReceivables` was missing `isAdminTier` — CEO/Admin couldn't edit or delete receivables
- Finance inbox scanner was still trying `khuram1901@gmail.com` (token deleted) causing silent failures every run

**New:**
- Inline Edit + Delete on every receivables bill card — Edit button opens form to amend customer, amount, dates, refs, bill type, notes; Delete with confirmation prompt
- `/api/finance/setup-gmail-filter` — one-shot route to create `cockpit-cash` Gmail label + filter on k.saleem@unzegroup.com automatically
- Gmail filter auto-labels incoming emails with "Cash Flow", "Bank Position", or "cash sheet" in subject + attachment

**Database changes:**
- Migration 051: expand DELETE RLS on production_entries/dispatch_entries/breakage_entries from Nadeem-only to `is_ops_manager()` (all 4 Ops Managers)

---

## 2026-07-02 — Features 1-2, 7-9, Google OAuth fix, edit permissions

**Features built:**
- Feature 1: PO Delivery Forecast — estimated completion date + daily rate on stock summary + stock page
- Feature 2: Authority Letter Expiry Tracker — migration 049 (expiry_date), amber/red badges, warning banner, dashboard alerts
- Feature 7: Contractor Performance Tracker — new API route + performance cards on manage page
- Feature 8: WhatsApp Dispatch Notification — auto-email to Ops Managers with pre-filled WhatsApp button on every dispatch
- Feature 9: Monthly PO Progress Report — cron route `/api/reports/monthly-po`, runs 1st of each month, per-plant/PO email to Ops Managers + Admin

**Edit permissions for Ops team:**
- PATCH routes added for authority-letters, contractors, dispatch-records, production-allocations
- Edit Letters / Edit Dispatches / Edit Contractor UI added to `/stock/manage`
- All four Ops Managers (asif, usman, yahya, nadeem @unze.co.uk) can amend mistakes

**Google OAuth fix:**
- Root cause: `GOOGLE_REDIRECT_URI` was blank on Vercel production
- Fixed: set to `https://unze-cockpit.vercel.app/api/google/callback`
- Fixed: refresh_token overwrite bug in both callback routes
- Consolidated to single account: k.saleem@unzegroup.com for calendar + Gmail + notifications + backup
- Migration 050: deleted old khuram1901@gmail.com token from DB

**Database changes:**
- Migration 049: `alter table authority_letters add column if not exists expiry_date date`
- Migration 050: `delete from google_oauth_tokens where user_email = 'khuram1901@gmail.com'`

---

## 2026-07-01 00:00 — Initial blueprint created

**Files changed:**
- `BLUEPRINT.md` — created from scratch (initial run of blueprint-keeper agent)
- `CHANGELOG.md` — created from scratch

**Database changes:**
- All tables documented; last migrations applied were 048 (purchase_orders, production_allocations, contractors, po_contractors, authority_letters, dispatch_records) and 049 (authority_letters.expiry_date column)

**Behaviour changes (most recent, as of initial blueprint):**

Stock system (built 2026-07-01):
- Plant → PO → Contractor → Authority Letter → Dispatch Record hierarchy fully operational
- `/stock` page: collapsible tree view for all Ops + Admin users
- `/stock/manage` page: create POs, contractors, authority letters for Ops Managers + Admin
- `/production` daily entry now includes PO card picker (production allocation) and authority letter number lookup (dispatch)
- Dispatch dual-write: `dispatch_entries` (legacy) + `dispatch_records` (stock system) — both writes permanent
- "Stock by Customer PO" section added to Ops Dashboard
- Sidebar: "Operations Dept" page removed; "Stock" and "Manage POs" added

Operations (built 2026-06-29):
- Task ownership enforced — `assigned_by_email` column added; protected tasks (created by Admin/CEO/PA) restrict assignee edit/delete
- Due date required on all tasks
- Receivables kanban with HTML5 drag-and-drop
- `canEditReceivables` restricted to Ops dept only (Finance managers view-only)
- 9 receivable stages re-seeded; `bill_type` column added (Normal, Sales Tax, Retention)
- Overflow fix: `overflowX: hidden` removed from SidebarLayout and all `<main>` tags
- 49 upgrades across security, database, performance, UI, and new features (see memory/blueprint-complete.md for full list)

Permission model (migration 027):
- `is_admin_or_exec()` now aliases `is_admin_tier()` — Executive/PA no longer gets admin-tier DB access
- `is_privileged()` created for operational tables (tasks, members) that PA should access
- Finance/receivables/OAuth RLS explicitly excludes Executive role

**Decisions:**
- "General" renamed "Executive Office" everywhere — banned from codebase
- Inline styles (not Tailwind) established as the permanent styling approach
- `isAdminTier` vs `canEditFinance` distinction documented and enforced
- Dual-write for dispatch locked in permanently
- PA (Executive role) financial exclusion enforced at permission, RLS, and UI levels

---
