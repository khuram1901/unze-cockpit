# Changelog — Unze Group Dashboard

Most recent entry at the top. **Append-only — never delete or edit old entries.**

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
