# Changelog — Unze Group Dashboard

Most recent entry at the top. **Append-only — never delete or edit old entries.**

---

## 2026-07-05 — Restyle Operations Dashboard to Genspark design system

**Files changed:** `app/dashboard/DashboardView.tsx`, `app/dashboard/MonthlyTargets.tsx`

### What changed (visual only — no logic, queries, or data flows touched)

- **62 hardcoded hex values replaced** with `COLOURS.*` tokens from `SharedUI.tsx`
- **Good Stock hero card** — dark ink-900 background, 44px Inter Tight number, matches mobile design spec
- **5 compact KPI cards** — 26px Inter Tight numbers, uppercase kicker labels (10.5px), hairline-border cards, no top-accent strip
- **Card treatment** — borderRadius 14px (RADII.CARD), 24px padding, hairline borders, no shadows
- **Section titles** — `SectionTitle` component from SharedUI (Inter Tight 22px, w600, no border-left bar)
- **Tab strip** — pill tabstrip replacing solid navy pill buttons
- **Alert banner** — Genspark pattern: soft background, 30×30 rounded icon mark with triangle/check SVG, COLOURS tokens
- **Status badges** — `StatusBadge` component (soft background + matching text colour) replacing solid colour + white text
- **JetBrains Mono** — all table body numbers, percentages, dates, bar labels use `var(--font-mono)`
- **Breakage rate rows** — 3-column layout with ultra-thin bar + threshold marker at 1.5%
- **MonthlyTargets** — COLOURS tokens, pill buttons, TRACK progress bars, kicker labels
- **Build:** `npm run build` clean — 0 TypeScript errors

---

## 2026-07-05 — Remove legacy /executive page

- `app/executive/page.tsx` deleted — its functionality was fully merged into `app/home/page.tsx` in earlier sessions.
- `app/executive/EscalationTrafficLights.tsx` moved to `app/lib/EscalationTrafficLights.tsx` (git rename, no history loss). Updated to use COLOURS tokens and Genspark type scale.
- `next.config.ts`: permanent 308 redirect added — `/executive` → `/home`. Bookmarks, old email links, and muscle memory all continue to work.
- `app/api/notifications/digest/route.ts`: email link for admins updated `/executive` → `/home`.
- `app/api/reports/weekly/route.ts`: weekly report link updated `/executive` → `/home`.
- `app/home/page.tsx`: import path updated to `app/lib/EscalationTrafficLights`.
- BLUEPRINT.md updated: folder removed from file tree, route entry updated, notification flow updated.

---

## 2026-07-05 — Pass 3: font fix, colour sweep, number scale

### Font fix (`app/layout.tsx`)
- `Inter_Tight` was loaded without an explicit `weight` array — `next/font/google` defaults to weight 400 only. Weight 600 was not downloaded, causing all display numbers to fall back to system bold (blocky appearance). Fixed: `weight: ["400", "500", "600", "700"]` added to both Inter and Inter Tight.

### Colour sweep (`app/executive/page.tsx` — 91 hardcoded hex → 0)
- All old hex values replaced with COLOURS token references: `#16a34a`/`#059669` → GREEN, `#dc2626` → RED, `#d97706` → AMBER, `#2563eb` → BLUE, `#1e293b` → NAVY, `#e2e8f0`/`#f1f5f9` → HAIRLINE, `#f8fafc` → CANVAS, `#fef2f2` → DANGER_SOFT, `#fffbeb` → WARNING_SOFT.
- Destructure at top of file expanded to include all tokens.
- JSX props fixed: bare `color=GREEN` → `color={GREEN}` etc. (sed stripped quotes; Python regex wrapped with braces).
- Chart legend names cleaned: "Produced (solid green)" → "Produced" etc.
- Company Comparison bars: 18px height, 70% opacity, tabular-nums figures.
- `app/home/page.tsx` was already clean (0 hardcoded hex).

### Number scale calibration (`app/home/page.tsx`)
- Rule: only Good Stock hero (60px) and 6 ops KPI cards (44px) get full display size. Everything else secondary.
- `summaryCard` (Cash Available / Money In / Money Out): 36px → 28px.
- `Mini` component (Receivables totals): 32px → 24px.
- Monthly Receipts/Payments fallback card: 32px → 24px.
- "No plan set" sub-label: `BLUE` → `SLATE` (quiet, not a CTA).

---

## 2026-07-05 — Genspark deep restyle: sidebar + executive dashboard (second pass)

### Sidebar (`app/lib/SidebarLayout.tsx`, `app/lib/pageRegistry.ts`)
- Group structure overhauled: OVERVIEW → FINANCE → DEPARTMENTS → OPERATIONS → SETTINGS → PREFERENCES (bottom)
- "Tasks & Meetings" and "Command Centre" groups eliminated; tasks/calendar/meetings moved to OPERATIONS; profile/minutes stay in OVERVIEW
- Brand area: NAVY square "U" mark + "Unze Group" / "Operations" sub-label (replaced logo image). Image import removed.
- Nav items: 13px Inter, active = NAVY background + white text — no blue left-bar. Hover = `var(--sidebar-hover-bg)`
- Group labels: 10px / 500 weight / 0.12em letter-spacing / uppercase SLATE kickers
- User card: gradient round avatar (blue gradient), 13px/600 name, 11px SLATE role label
- Dark Mode moved into PREFERENCES group (nav item inside scroll area)
- Collapse + Sign Out moved below user card as small tertiary controls

### Executive Dashboard — greeting & hero (`app/home/page.tsx`)
- Greeting header: Inter Tight 44px/600, "Good morning, [name]." — full period. Metadata line: date + role chip below
- Good Stock hero: dark NAVY card, 60px Inter Tight number (44px mobile), white text, footer with "pairs · all plants combined"

### Executive Dashboard — KPI numbers (all pages)
- Card component: 44px Inter Tight numbers (was 22px), -0.02em tracking, 24px padding
- KPICard component: 44px numbers, 24px padding
- Mini component: 32px numbers
- CompanyFinancePanel.summaryCard: 36px numbers
- Bank Facilities figures: 36px per metric (utilisation %, available, seized)
- Investment tiles: 28px (4-tile grid, 2-col on mobile)
- Monthly receipts/payments fallback: 32px
- All tracking updated to -0.02em (was -0.015em)
- SectionTitle (SharedUI): bumped 20px → 22px

### Executive Dashboard — section-specific changes
- **Attention banner chips**: soft chips (coloured text on SOFT bg — DANGER_SOFT/WARNING_SOFT) — no longer white-on-solid
- **Cash Flow Waterfall**: 160px bar area (was 118px), 24px padding, muted bars (55% opacity)
- **Company Comparison**: 18px bar height (was 14px), kicker labels, muted bars (70% opacity)
- **Bank Facilities**: hero layout per bank — kicker name, 36px utilisation/available/seized figures, hairline progress bar
- **Department Scorecard**: editorial rows — left 8px status dot, owner sub-label, right soft chip (SOFT bg + saturated text); no execCard border-top accent
- **Task Load chart**: 220px min height (was 180px), 46px per row (was 38px), muted bars, sober palette

---

## 2026-07-05 — Genspark design system foundation installed

- `app/lib/SharedUI.tsx` — full rewrite of design tokens and shared components to match Genspark design system v1. All exports preserved (backward-compatible). Key changes:
  - COLOURS: NAVY `#1e293b` → Ink 900 `#0F1720`, GREEN `#16a34a` → `#0F7B5F`, AMBER `#d97706` → `#B4791F`, RED `#dc2626` → `#B3261E`, BLUE `#2563eb` → Accent `#3B4CCA`. PURPLE and TEAL remapped to Accent and Success respectively.
  - New tokens: CANVAS, CARD, CARD_ALT, HAIRLINE, TRACK, INK_700, INK_400, INK_300, SUCCESS_SOFT, WARNING_SOFT, DANGER_SOFT.
  - New exports: `cardStyle`, `cardAltStyle` — base card containers.
  - RADII: CARD 12px → 14px. PILL/BUTTON now `999px`. New XS (6px), SM (10px), LG (20px).
  - SHADOWS: CARD now `none` per design spec. Other shadows updated to use `rgba(15,23,32,…)`.
  - `StatusBadge` / `PriorityBadge`: coloured-text chip on soft background (was white text on solid colour).
  - `SectionTitle`: Inter Tight 20px/600, no border-left accent.
  - `tableHeaderStyle`: uppercase label style, card-alt background.
  - `labelStyle`: uppercase kicker style.
  - `primaryButtonStyle`: pill radius, 13px.
- `app/layout.tsx` — three `next/font/google` fonts added (Inter, Inter Tight, JetBrains Mono). CSS variables `--font-display`, `--font-sans`, `--font-mono` injected on `<html>`. No npm install required — `next/font` is built into Next.js. Source Sans 3 retained for backward compatibility.
- `designs/DESIGN_MAP.md` — permanent reference mapping all 23 Genspark HTML design files to their corresponding code files.
- `BLUEPRINT.md` — Design System section fully rewritten to reflect new tokens, type scale, and component table.
- No individual page files changed — foundation only.

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

---

## 2026-07-04 — Performance optimisation (DB-side calculations)

**Goal:** Move data calculations out of the browser and into Supabase (Postgres). Pages now receive small pre-aggregated results instead of large raw datasets.

**Files changed:**
- `supabase/054_portfolio_summary_rpc.sql` — NEW migration (applied)
- `supabase/055_plant_kpi_rpc.sql` — NEW migration (applied)
- `supabase/056_receivables_summary_rpc.sql` — NEW migration (applied)
- `app/investments/page.tsx` — date selector added; RPC replaces raw fetch
- `app/home/page.tsx` — plant KPIs, investments, receivables, dept health all use RPCs/COUNTs
- `app/executive/page.tsx` — plant KPIs and investments use RPCs; 15-query → 9-query load
- `app/dashboard/DashboardView.tsx` — plant KPIs use RPC; stock tab uses single request for all plants

**Database changes:**
- Migration 054: `get_portfolio_summary_as_of(as_of date)` — DISTINCT ON price_history + holdings aggregate; replaces two-table JS fetch
- Migration 055: `get_plant_kpis(as_of_date, month_start, month_end)` — replaces 7 raw 90-day table fetches; returns one row per active plant with opening balances, cumulative totals, on-date totals, MTD totals, entered_on_date
- Migration 056: Three receivables RPCs — `get_receivable_rag_by_customer()`, `get_receivable_aging_totals()`, `get_receivable_aging_by_customer()` — replace full select("*") + JS aggregation loops

**Behaviour changes:**
- Investments page: date selector (DateInput) lets CEO view portfolio as of any past date; "Back to today" button + blue historical banner
- Home page plant summary: closing stock, breakage, entered-today indicators unchanged — same numbers, now computed in Postgres
- Receivables section: RAG totals, aging buckets, customer groupings unchanged — verified PKR 171,995,700 across all three RPCs matches
- Ops/Finance Manager briefing: task open/overdue counts from COUNT queries (zero rows downloaded)
- Stock tab on Ops Dashboard: single HTTP request for all plants instead of one per plant
- Monthly production/dispatch/breakage arrays kept for daily ops chart (per-day breakdown) and quarterly escalation checks

**Performance impact:**
- Home page: ~15 queries → ~9 queries; raw row downloads reduced from thousands to tens
- Executive page: ~15 queries → ~9 queries; 7 raw 90-day dumps eliminated
- Ops Dashboard: ~11 queries → ~6 queries; stock tab N-requests → 1
- Receivables: 2 full-table fetches → 3 RPC calls returning ~10 rows each

**Verification:** All RPC outputs cross-checked against raw table data — all matched. No data loss.

