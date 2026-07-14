# Unze Group Dashboard — Living Blueprint

> **This is the source of truth.** Read before touching any code. Last updated: 14/07/2026 (Tasks page rebuild, Phases 3–5: migrations 098–105 — company tag, stage, locked assigned/original-due dates, subtasks with DB-enforced completion gating, due-date history, Stuck status (red), Kanban board, Recurring tab, Team tab, monthly/quarterly RPCs, attention banner, My Tasks tab, real filters, task-detail modal, mini-checklist, comments, WhatsApp auto-remind toggle, calendar picker, meeting chip — see "Tasks page redesign" section for the full history including the mockup-reconciliation pass after Khuram flagged the live page didn't match what was designed).
>
> **British English throughout.** All dates in DD/MM/YYYY.

---

## 1. Project Metadata

### Identity
| Field | Value |
|-------|-------|
| Project name | business-cockpit (package.json), Unze Group Dashboard |
| Live URL | https://pulse.unze.co.uk |
| Staging URL | Vercel preview deployments on every PR |
| Deployment | Vercel (automatic on push to main) |
| GitHub | khuram1901/unze-cockpit |
| Node version | Not pinned in package.json; Vercel default |

### Tech Stack (exact versions from package.json)
| Package | Version |
|---------|---------|
| next | 16.2.9 |
| react | 19.2.4 |
| react-dom | 19.2.4 |
| @supabase/supabase-js | ^2.108.1 |
| @anthropic-ai/sdk | ^0.80.0 |
| googleapis | ^173.0.0 |
| recharts | ^3.8.1 |
| mammoth | ^1.12.0 |
| pdf-parse | ^1.1.1 |
| pdfjs-dist | ^4.10.38 |
| web-push | ^3.6.7 |
| xlsx | ^0.18.5 |
| typescript | ^5 |
| tailwindcss | ^4 (dev only, not used at runtime — all styles are inline) |

### Environment Variables Required
| Key | Purpose | Required |
|-----|---------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase public anon key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for server-side DB writes | Yes |
| `ANTHROPIC_API_KEY` | Claude API for meeting extraction | Yes |
| `CRON_SECRET` | Shared secret to authenticate scheduled cron endpoints | Yes |
| `GOOGLE_CLIENT_ID` | OAuth2 for Gmail/Calendar integration | Yes |
| `GOOGLE_CLIENT_SECRET` | OAuth2 for Gmail/Calendar integration | Yes |
| `GOOGLE_REDIRECT_URI` | OAuth2 callback URL | Yes |
| `GOOGLE_NOTIFICATION_CLIENT_ID` | Separate OAuth app for Gmail push notifications | Yes |
| `GOOGLE_NOTIFICATION_CLIENT_SECRET` | Separate OAuth app for Gmail push notifications | Yes |
| `GOOGLE_NOTIFICATION_REDIRECT_URI` | Callback for notification OAuth | Yes |
| `VAPID_PUBLIC_KEY` | Web push notifications | Yes |
| `VAPID_PRIVATE_KEY` | Web push notifications | Yes |
| `VAPID_EMAIL` | Web push contact email | Yes |
| `ENCRYPTION_KEY` | 32-byte key for encrypting OAuth tokens in DB | Yes |
| `NEXT_PUBLIC_APP_URL` | Used by taxAlertEngine for email links | Yes |

---

## 2. Complete Folder Structure

```
app/
├── layout.tsx                        Root layout — wraps all pages in ThemeProvider + AuthWrapper
├── page.tsx                          Root redirect — sends / → /home or /login
├── globals.css                       Global CSS variables (light/dark), login animations.
│                                     Tooltip rule updated: background uses var(--text-primary)
│                                     instead of raw #1e293b for theme consistency.
├── favicon.ico                       App icon
│
├── login/page.tsx                    Login page — time-based greeting, crossfade carousel, Supabase auth.
│                                     Branding corrected to "Unze Group" (was "PulseDesk"). All colours
│                                     now via COLOURS tokens (COLOURS.BLUE replaces raw #3b82f6).
├── forgot-password/page.tsx          Request password reset email via Supabase
├── reset-password/page.tsx           Confirm new password from email link
│
├── home/page.tsx                     Home dashboard — page registry cards, CEO/admin briefing,
│                                     Manager briefing (ops/finance), Tax Compliance summary card,
│                                     Investments card including UK Pension summary (GBP + PKR),
│                                     cron health panel (admin only).
│                                     sessionStorage cache (2-min TTL) now includes pension summary
│                                     so it survives cache hits. var(--text-muted) → COLOURS.INK_400.
├── my-dashboard/page.tsx             Personal task summary for logged-in user
├── profile/page.tsx                  User profile — name, email, password change, notification prefs
│
├── pa/page.tsx                       PA Dashboard — tasks, notes, calendar events, delegations,
│                                     dividend calendar (confirmed only, no financial figures)
│
├── accounts-tax/
│   ├── page.tsx                      Accounts & Returns page shell
│   ├── AccountsTaxDashboard.tsx      Full dashboard: quarterly accounts schedule (5 entities × 5 steps),
│   │                                 annual accounts schedule (10 entities × 6 steps),
│   │                                 monthly/quarterly return filings (FBR Sales Tax, PRA Tax, Income Tax),
│   │                                 fiscal-year navigation, overdue detection per deadline
│   └── TaxComplianceSummary.tsx      Summary card component — shows filing %, schedule completion
│                                     per quarter. Used on home page as a clickable summary tile.
│
├── dashboard/
│   ├── page.tsx                      Operations Dashboard shell — loads DashboardView
│   ├── DashboardView.tsx             Full ops dashboard: plant KPIs, charts, stock by PO,
│   │                                 tasks, machine issues, breakage pareto.
│   │                                 Restyled to Genspark design system (2026-07-05):
│   │                                 dark hero card (Good Stock), 5 compact KPI cards,
│   │                                 pill tabstrip, COLOURS tokens throughout, JetBrains
│   │                                 Mono for tabular numbers, soft status badges.
│   └── MonthlyTargets.tsx            Monthly targets edit form. Restyled (2026-07-05):
│                                     COLOURS tokens, pill buttons, TRACK progress bars.
│
├── finance/
│   ├── page.tsx                      Finance index — company picker, dept budgets, bulk upload
│   │                                 Restyled to Genspark design system (2026-07-06):
│   │                                 hairline cards, kicker labels, pill buttons, no accent strips
│   ├── FinanceManager.tsx            Per-company finance dashboard: daily position, opening balance,
│   │                                 cash plan, monthly budgets, charts. "Reconnect Google" button
│   │                                 returns user to company page after OAuth.
│   │                                 Restyled to Genspark design system (2026-07-06):
│   │                                 Net Position = dark hero card (NAVY bg, Inter Tight 44px);
│   │                                 daily table uses JetBrains Mono; all hex → COLOURS tokens;
│   │                                 modals: RADII.CARD + kicker labels; hairline-only borders
│   ├── [company]/page.tsx            Dynamic route — passes slug to FinanceManager
│   ├── guarantees/page.tsx           Bank Facilities — guarantee records by bank, facility utilisation,
│   │                                 pay orders, bill linking, chase urgency, expiry tracking
│   └── upload/page.tsx               Manual PDF upload — drag-and-drop cash flow + bank position
│                                     PDFs, auto-detects company, shows per-file save status
│
├── receivables/page.tsx              Receivables kanban — stage pipeline for MEPCO/customer bills
│
├── investments/page.tsx              PSX portfolio tracker — holdings, current prices, P&L,
│                                     dividend tracking (confirmed + auto-fetched), Today's Change card.
│                                     UK Pension section: total value (GBP + PKR), net gain, return %,
│                                     contributed, fees, fund breakdown (fund name, ISIN, units, price,
│                                     value, allocation %). Calls get_pension_summary and
│                                     get_pension_fund_breakdown RPCs directly — no sessionStorage cache.
│
├── opening-balances/
│   ├── page.tsx                      Opening balances page shell
│   └── OpeningBalancesForm.tsx       Form to set/edit per-company starting balances
│
├── production/
│   ├── page.tsx                      Daily entry page shell
│   ├── ProductionForm.tsx            Daily production/dispatch/breakage entry form with PO allocation
│   └── ReceivablesSection.tsx        Receivables quick-add form embedded in production page
│
├── stock/
│   ├── page.tsx                      Stock tree view — Plant → PO → Contractor → Letter
│   └── manage/page.tsx               Manage POs — create/edit POs, contractors, authority letters
│
├── tasks/
│   ├── page.tsx                      Tasks page shell
│   ├── TasksPageClient.tsx           Tasks page client — view switcher, filters
│   ├── TasksList.tsx                 Task list component — department/weekly/monthly/timeline views
│   ├── NewTaskForm.tsx               Create/edit task form — description, owner, due date (required)
│   └── TaskStatus.tsx                Inline status badge/selector component
│
├── calendar/page.tsx                 Calendar — tasks view by due date
│
├── meetings/page.tsx                 Meetings admin — Past Meetings tab, Decision Log tab
│
├── my-minutes/page.tsx               My Minutes — personal meeting minutes (all users)
│
├── recurring-tasks/page.tsx          Recurring task templates — frequency, assignee, day settings
│
├── members/
│   ├── page.tsx                      Members page shell
│   ├── MembersManager.tsx            Member list, invite, edit role/dept, delete
│   └── AccessMatrix.tsx              Permission override grid — per-member boolean toggles
│
├── department/[slug]/
│   ├── page.tsx                      Department page router — dispatches to correct dashboard
│   ├── DepartmentDashboard.tsx       Default department view — tasks, notices
│   ├── AuditDashboard.tsx            Audit dept — audit plan items, findings.
│                                     Multi-company: companyFilter state with UTPL/IFPL/BRNH/HD/ALM/DIR
│                                     tabs via PillTabs. company_id column on audit records.
│                                     CompanyBadge component: UTPL=blue (#EEF1FC/BLUE), IFPL=green
│                                     (SUCCESS_SOFT/GREEN). 6 entity types including Directors.
│   ├── HRDashboard.tsx               HR dept — recruitment, evaluations, strategy goals
│   ├── TaxationDashboard.tsx         Tax Notices — legal notices (notice_type='tax').
│   │                                 Enhanced: is_active (Active/Inactive toggle), notice_status
│   │                                 ('Order'/'Notice'/'Show Cause'), legal_stage
│   │                                 ('Authority'/'Department'/'CIR Appeal'/'Tribunal'/
│   │                                 'High Court'/'Supreme Court'). Active/inactive filter tabs.
│   │                                 canManageTaxNotices gates write access.
│   └── AdminDashboard.tsx            Admin dept — categories, spend tracking
│
├── exceptions/page.tsx               Exception management — surfaced alerts and rule violations
├── audit-log/page.tsx                System audit log — all user actions (timestamped)
├── admin/page.tsx                    Data & Backups — source document archive, backup/restore
│                                     (khuram1901@gmail.com ONLY). All colours via COLOURS tokens;
│                                     RADII.CARD, RADII.PILL, RADII.SM used throughout; no raw hex.
│
├── monthly-operations-targets/page.tsx  Monthly production/dispatch targets per plant.
│                                     Full Genspark restyle: all var(--*) and raw hex replaced
│                                     with COLOURS tokens; shared table styles; RADII.PILL buttons;
│                                     progress bars use TRACK + RADII.PILL; font sizes 13–14px.
│
├── folderit/page.tsx                 Folderit DMS dashboard — pending approvals + company inbox counts +
│                                     HR category counts. Drill-down lists per section/company.
│                                     Search across company inboxes + HR policies + HR inbox.
│
└── lib/
    ├── supabase.ts                   Supabase browser client + loadMyPermissions helper
    ├── supabase-server.ts            createServiceClient() — server-side (bypasses RLS)
    ├── api-auth.ts                   requireAuth(req) — validates Bearer token in API routes
    ├── permissions.ts                Central permission functions — SINGLE SOURCE OF TRUTH
    ├── pageRegistry.ts               PAGE_REGISTRY — maps permKeys to home dashboard cards
    │                                 GROUP_ORDER: Overview → Operations → Departments → Finance →
    │                                 My Workspace → Settings → Preferences
    ├── useRouteGuard.ts              useRequireCapability() + useRequireDepartment() hooks.
│                                     Capabilities: finance, receivables, executive, operations,
│                                     minutes, meetings_admin, recurring_tasks, members, audit_log,
│                                     exceptions, import_export, daily_entry, pa_dashboard,
│                                     investments, system_backups, stock, guarantees.
│                                     useRequireDepartment: special-case for Shakeel on Tax dept.
    ├── useUserCtx.ts                 useUserCtx() hook — loads user role/dept/overrides
    ├── AuthWrapper.tsx               Wraps app — handles auth state, notification bell, sidebar
    ├── SidebarLayout.tsx             Sidebar nav + mobile header — visibility via PERM_FUNC map.
    │                                 SIDEBAR_GROUPS order: Overview → Operations → Departments →
    │                                 Finance → My Workspace → Settings.
    │                                 "Tasks & Meetings" and "Command Centre" groups removed.
    │                                 Items within each group are sorted A–Z case-insensitively at
    │                                 render time via .sort().
    │                                 Active item: 3px COLOURS.BLUE left accent bar (expanded);
    │                                 3px transparent (collapsed) — no layout shift on toggle.
    ├── ThemeProvider.tsx             Dark/light mode context
    ├── SharedUI.tsx                  Design tokens (COLOURS, RADII, SHADOWS) + shared components
    ├── constants.ts                  COMPANIES array — 6 entities: UTPL, IFPL, BRNH (Baranh),
│                                     HD (Haute Dolci), ALM (Almahar), DIR (Directors) with IDs,
│                                     shortCodes, slugs, currency. getCompanyBySlug / getCompanyById /
│                                     getCompanyByName helpers. Used by admin, audit, and finance pages.
    ├── dateUtils.ts                  formatDateUK, formatDateTimeUK, todayISO, etc.
    ├── DateInput.tsx                 Custom DD/MM/YYYY date input — replaces all <input type="date">
    │                                 Shows DD/MM/YYYY, auto-inserts slashes, validates on blur,
    │                                 calls onChange with YYYY-MM-DD. Fixes Safari MM/DD/YYYY issue.
    ├── taxAlertEngine.ts             Tax deadline alert engine — called by the nightly cron and
│                                     fire-and-forget after each AccountsTaxDashboard save.
    │                                 fire-and-forget after each AccountsTaxDashboard save.
    │                                 computeAndStoreTaxAlerts(supabase, taxYear) → upserts
    │                                 tax_deadline_alerts rows; sends email to CEO on new alerts.
    │                                 Two-tier alerts: tier 1 = first warning, tier 2 = overdue.
    │                                 Covers: quarterly/annual schedules, FBR/PRA monthly returns,
    │                                 Income Tax quarterly returns, annual personal/company returns.
    ├── EscalationTrafficLights.tsx   Traffic-light component (moved from app/executive/ in 2026-07-05)
    ├── department-config.ts          Department slug → name mapping
    ├── audit-log.ts                  logAuditEvent() helper
    ├── send-email.ts                 Email sending via Gmail API
    ├── notification-types.ts         Named trigger-type constants (task_assigned, escalation)
    ├── task-notifications.ts         notifyTaskAssigned() / notifyEscalationTask() — shared by /api/notifications/send and createTaskCore
    ├── task-creation.ts              createTaskCore() — the one gate every task-creation path routes through (see TASK_NOTIFICATION_AUDIT.md)
    ├── google-client.ts              Google OAuth2 client setup
    ├── folderit-auth.ts              Folderit API auth helper — client-credentials token management
    ├── crypto.ts                     Token encryption/decryption for OAuth storage
    ├── rate-limit.ts                 In-memory rate limiter (resets on cold start)
    ├── backup-tables.ts              List of tables included in backups
    ├── document-archive.ts           Document archive helper
    ├── exportUtils.ts                downloadCSV() helper
    ├── whatsapp.ts                   WhatsApp notification helper
    ├── useMobile.ts                  useIsMobile() — 768px breakpoint hook
    ├── ImportExportButtons.tsx       Shared import/export UI component
    ├── MyTasks.tsx                   My tasks list component (used on home/my-dashboard)
    ├── excel-parsers/
    │   └── cash-flow-forecast-parser.ts  Parse Excel cash flow forecast uploads
    └── pdf-parsers/
        ├── bank-position-parser.ts   Parse PDF bank position statements
        ├── cash-flow-parser.ts       Parse PDF cash flow documents
        ├── extract-text.ts           Raw text extraction from PDF
        ├── pdf-parse.d.ts            Type declarations for pdf-parse
        └── reconcile.ts             Reconcile parsed vs existing position data

api/
├── admin/
│   ├── cron-health/route.ts          GET — checks health of 6 integrations (Gmail, Calendar, etc.)
│   ├── list-backups/route.ts         GET — lists backup files in Supabase Storage
│   ├── list-documents/route.ts       GET — lists source documents archive
│   ├── restore/route.ts              POST — restores a backup
│   └── wipe-data/route.ts            POST — wipes selected table data (admin only)
├── auth/
│   ├── change-password/route.ts      POST — change own password
│   ├── reset-password/route.ts       POST — request password reset email
│   └── set-password/route.ts         POST — set password (invite flow)
├── backup/route.ts                   POST — trigger manual backup to Supabase Storage
├── calendar/
│   ├── create-event/route.ts         POST — create Google Calendar event
│   └── freebusy/route.ts             GET — check calendar free/busy (auth required)
├── cron/
│   └── tax-alerts/route.ts           GET (cron Bearer CRON_SECRET) + POST (fire-and-forget,
│                                     Supabase session auth) — calls computeAndStoreTaxAlerts().
│                                     Runs twice daily: 00:00 UTC and 06:00 UTC.
├── finance/
│   ├── bulk-upload/route.ts          POST — upload multiple PDF cash flow files (admin only)
│   ├── upload-pdfs/route.ts          POST — manual drag-and-drop PDF upload
│   ├── check-drive/route.ts          GET — cron every 10min; reads PDFs from Google Drive Drop Here folder
│   ├── setup-drive-folder/route.ts   GET — one-time setup; creates Google Drive folder structure
│   ├── setup-gmail-filter/route.ts   GET — creates cockpit-cash Gmail label + filter
│   ├── check-inbox/route.ts          POST — check Gmail for new finance PDFs (admin only)
│   ├── parse-cash-flow/route.ts      POST — parse uploaded PDF into daily position data
│   ├── upload-forecast/route.ts      POST — upload Excel cash flow forecast
│   ├── guarantees/route.ts           GET/POST/PATCH/DELETE — Bank guarantee records.
│   │                                 GET: Admin, CEO, Finance Manager, Ops Manager only.
│   │                                 POST/PATCH/DELETE: Admin, CEO, Finance Manager only.
│   │                                 Any other authenticated user → 403 Forbidden.
│   │                                 Server-side role check enforced in addition to UI-level gates.
│   └── guarantee-facilities/route.ts All methods: Admin, CEO, Finance Manager only → 403 otherwise.
│                                     Server-side role check enforced in addition to UI-level gates.
├── folderit/
│   ├── _shared.ts                    Shared Folderit API client helper (auth token + base URL)
│   ├── sync/route.ts                 GET (cron every 30 min) — syncs inbox files + resolution invites
│   │                                 from all active Folderit accounts into DB tables
│   ├── summary/route.ts              GET — calls get_folderit_summary RPC; counts for home/sidebar badges
│   ├── company-breakdown/route.ts    GET — calls get_folderit_company_breakdown RPC; per-company inbox/approval counts
│   ├── details/route.ts              GET — calls get_folderit_details RPC; drill-down lists
│   ├── hr-summary/route.ts           GET — calls get_folderit_hr_categories RPC; HR category file counts
│   ├── hr-inbox/route.ts             GET — calls get_folderit_hr_inbox RPC; HR inbox file list
│   ├── hr-search/route.ts            GET — calls search_folderit_hr_files RPC; HR policies + inbox search
│   ├── search/route.ts               GET — calls search_folderit_inbox RPC; company inbox search (scoped by company)
│   ├── overdue/route.ts              GET — calls get_folderit_overdue_items RPC; files overdue for filing/approval
│   └── file-url/route.ts             GET — returns a signed preview URL for a Folderit file_uid
├── google/
│   ├── auth/route.ts                 GET — initiate Google OAuth2 flow
│   ├── callback/route.ts             GET — OAuth2 callback
│   ├── auth-notifications/route.ts   GET — initiate OAuth2 flow (Gmail notifications)
│   ├── callback-notifications/route.ts GET — OAuth2 callback (Gmail notifications)
│   └── status/route.ts              GET — check connected Google accounts
├── health/route.ts                   GET — basic health check endpoint
├── investments/
│   ├── update-prices/route.ts        POST — refresh PSX stock prices (admin only)
│   ├── dividends/route.ts            GET/POST/PATCH/DELETE — stock_dividends CRUD. GET?mode=upcoming
│   │                                 calls get_upcoming_dividends RPC.
│   ├── daily-summary/route.ts        Weekday cron (05:00 UTC) — calls get_portfolio_daily_summary RPC,
│   │                                 upserts portfolio_snapshots, emails Khuram.
│   ├── fetch-dividends/route.ts      Weekday cron (06:00 UTC) — POSTs to PSX DPS per holding ticker,
│   │                                 parses HTML, inserts unconfirmed dividends. Never overwrites confirmed.
│   └── fetch-pension-prices/route.ts Weekday cron (23:00 UTC) — fetches UK pension fund prices from
│   │                                 Morningstar. Funds: GB00BVRZG281 → F00000VBU2 (L&G),
│   │                                 GB00BRDCMX84 → VAUSA0P5GL (Vanguard). Upserts pension_fund_prices.
│   │                                 Fallback prices hardcoded for outage resilience.
│   │                                 Auth: CRON_SECRET Bearer OR Admin/CEO Supabase session.
├── me/
│   └── permissions/route.ts          GET — return current user's permission overrides
├── meetings/
│   ├── check-inbox/route.ts          POST — check Gmail for meeting minutes emails
│   ├── extract/route.ts              POST — AI extraction of meeting details via Claude
│   ├── parse-file/route.ts           POST — parse PDF/DOCX meeting file
│   └── send-minutes/route.ts         POST — send meeting minutes email to attendees
├── members/
│   └── invite/route.ts               POST — invite new member (creates Supabase auth user)
├── notifications/
│   ├── digest/route.ts               POST — send digest notification (cron)
│   ├── ceo-digest/route.ts           GET (cron Mon–Fri 06:30 UTC = 11:30am PKT) — calls get_ceo_daily_digest
│   │                                 RPC, emails Khuram a single summary: open tasks, escalations, Folderit
│   │                                 pending approvals. Replaces 50-70 individual task emails per day.
│   ├── password-changed/route.ts     POST — notify admin of password change
│   ├── push-subscribe/route.ts       POST — register push subscription
│   ├── push/route.ts                 POST — send push notification to specific user
│   └── send/route.ts                 POST — send email notification
├── reports/
│   ├── daily-pdf/route.ts            POST — generate and send daily PDF report (cron)
│   ├── weekly/route.ts               POST — generate and send weekly email digest (cron)
│   └── monthly-po/route.ts           POST — monthly PO progress report (cron, 1st of month)
├── stock/
│   ├── authority-letters/route.ts    GET/POST/PATCH — list/create/edit authority letters.
│   │                                 Expiry validation: expired letters are flagged; server enforces
│   │                                 blocking dispatch against expired letters.
│   ├── contractors/route.ts          GET/POST/PATCH — list/create/edit contractors
│   ├── dispatch-records/route.ts     GET/POST/PATCH — list/create/edit dispatch records.
│   │                                 Over-quantity check: rejects if dispatch would exceed letter
│   │                                 remaining balance (server-side hard block).
│   ├── production-allocations/route.ts GET/POST/PATCH — list/replace production allocations
│   ├── purchase-orders/route.ts      GET/POST/PATCH — manage purchase orders
│   └── summary/route.ts              GET — full stock tree per plant (POs → letters → balances)
└── tasks/
    └── recurring/route.ts            POST — generate recurring tasks from templates (cron)
```

---

## 3. Design System

**Source:** Genspark design system v1 (`designs/Design System.html` + 22 page designs in `designs/`).
**Installed:** 2026-07-05. Foundation only — tokens and shared components updated.
**Pages restyled:** /home (2026-07-05), /dashboard (2026-07-05), /finance (2026-07-06).
**Design map:** `designs/DESIGN_MAP.md` — maps every Genspark HTML file to its code file.

### Colours (SharedUI.tsx — COLOURS constant)

#### Surfaces
| Token | Hex | Use |
|-------|-----|-----|
| `CANVAS` / `BG` | `#F7F5F1` | Page background |
| `CARD` | `#FFFFFF` | Card surface |
| `CARD_ALT` | `#FBFAF7` | Tinted / alternate tile |
| `HAIRLINE` / `BORDER` | `#EEF0F3` | Borders, dividers |
| `TRACK` / `LIGHT` | `#F1F3F6` | Progress bar background |

#### Ink (text)
| Token | Hex | Use |
|-------|-----|-----|
| `NAVY` | `#0F1720` | Ink 900 — headlines, numbers, primary text |
| `INK_700` | `#334155` | Body copy |
| `SLATE` | `#64748B` | Ink 500 — labels, secondary text |
| `INK_400` | `#94A3B8` | Captions, metadata |
| `INK_300` | `#CBD5E1` | Disabled |

#### Status — solid
| Token | Hex | Use |
|-------|-----|-----|
| `GREEN` | `#0F7B5F` | Success / on-target |
| `AMBER` | `#B4791F` | Warning / needs attention |
| `RED` | `#B3261E` | Danger / critical / overdue |
| `BLUE` | `#3B4CCA` | Accent — links, CTAs, active state |

#### Status — soft (chip backgrounds)
| Token | Hex | Use |
|-------|-----|-----|
| `SUCCESS_SOFT` | `#E7F2ED` | Success chip / banner bg |
| `WARNING_SOFT` | `#FBF1DE` | Warning chip / banner bg |
| `DANGER_SOFT` | `#F8E4E2` | Danger chip / banner bg |

#### Role identity (Members/Admin area only)
| Token | Hex | Note |
|-------|-----|------|
| `PURPLE` | `#3B4CCA` | Remapped from `#7c3aed` → Accent |
| `TEAL` | `#0F7B5F` | Remapped from `#059669` → Success |

#### Group Colours (pageRegistry.ts — GROUP_COLOURS)
| Group | Colour |
|-------|--------|
| Overview | `#0F1720` (Navy) |
| Finance | `#0F7B5F` (Success green) |
| Operations | `#3B4CCA` (Accent blue) |
| Departments | `#B4791F` (Amber) |
| My Workspace | `#64748B` (Slate) |
| Settings | `#64748B` (Slate) |

### Fonts
Three custom fonts loaded via `next/font/google` in `app/layout.tsx`. CSS variables injected on `<html>`:

| Variable | Font | Use |
|----------|------|-----|
| `--font-display` | Inter Tight | Section titles, metric numbers, card titles |
| `--font-sans` | Inter | Body text, labels, buttons, UI |
| `--font-mono` | JetBrains Mono | Tabular numbers, IDs, due dates |

**Type scale:**
| Role | Font | Size / Weight / Tracking |
|------|------|--------------------------|
| Display / hero KPI | Inter Tight | 48–60px / 600 / −0.025em |
| Page title (H1) | Inter Tight | 32px / 600 / −0.02em |
| Section title (H2) | Inter Tight | 20–22px / 600 / −0.01em |
| Metric large | Inter Tight | 36–44px / 600 / −0.02em |
| Metric medium | Inter Tight | 26–32px / 600 / −0.02em |
| Metric small | Inter Tight | 22px / 600 / −0.015em |
| Body | Inter | 14px / 400 |
| UI text / sidebar | Inter | 13px / 400–500 |
| Label / kicker | Inter | 10.5–11px / 500 / 0.08em uppercase |
| Caption | Inter | 11–12px / 400 |
| Tabular / IDs | JetBrains Mono | 11–12px / 400 / tabular-nums |

### Border Radius (RADII constant)
| Token | Value | Usage |
|-------|-------|-------|
| `XS` / `BADGE` | `6px` | Small chips |
| `SM` | `10px` | Inputs, small chips |
| `CARD` | `14px` | Standard cards |
| `LG` | `20px` | Hero / feature cards |
| `PILL` / `BUTTON` | `999px` | Buttons, tab strips, filter pills |

### Shadows (SHADOWS constant)
Cards have **no shadow** by design (Genspark spec). Shadows reserved for overlays only.
| Token | Value | Usage |
|-------|-------|-------|
| `CARD` | `none` | Cards (no shadow) |
| `ELEVATED` | `0 2px 8px rgba(15,23,32,0.06)` | Subtle lifted panels |
| `DROPDOWN` | `0 8px 30px rgba(15,23,32,0.12)` | Dropdowns, menus |
| `MODAL` | `0 20px 60px rgba(15,23,32,0.15)` | Modal overlays |

### Spacing
- Base unit: 4px. Scale: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64
- Card padding: `24px`
- Between cards: `16–20px`
- Between sections: `32–40px`
- Page padding: `40px` desktop / `20px` mobile
- **NEVER use `overflowX: hidden` on `<main>` tags** — clips nested scroll containers

### Shared Components in lib/SharedUI.tsx

| Component / Export | Props | Purpose |
|-------------------|-------|---------|
| `COLOURS` | — | Colour token object — source of truth |
| `RADII` | — | Border radius constants |
| `SHADOWS` | — | Shadow constants |
| `cardStyle` | — | Base card style object (24px pad, 14px radius, hairline border) |
| `cardAltStyle` | — | Tinted card-alt variant |
| `displayRole(role, email?)` | string, string? | Returns "CEO" for k.saleem email, else role |
| `statusColor(status)` | string\|null | Maps status string to colour hex |
| `priorityColor(priority)` | string\|null | Maps priority to colour hex |
| `SectionTitle` | `{ title, style? }` | Inter Tight h2 at 22px/600 |
| `PageHeader` | `{ hideHome? }` | "← Home" back link pill |
| `StatusBadge` | `{ status }` | Coloured-text chip on soft background |
| `PriorityBadge` | `{ priority }` | Coloured-text chip on soft background |
| `CountCard` | `{ label, value, color, sub? }` | Metric card: label → number → sub |
| `TrafficLight` | `{ status: RAGStatus, label, detail? }` | Dot + label in Green/Amber/Red |
| `FreshnessBadge` | `{ date, label? }` | Data age: green 0–1d, amber 2–3d, red 4+d |
| `WARNING_BANNER_STYLE` | — | Warning banner style (amber, warning-soft bg) |
| `tableHeaderStyle` | — | `<th>` — uppercase label, card-alt bg |
| `tableCellStyle` | — | `<td>` — 13px, tabular-nums, hairline divider |
| `tableCellBoldStyle` | — | Bold variant of tableCellStyle |
| `labelStyle` | — | Form label — uppercase kicker style |
| `inputStyle` | — | Form input — 13px, hairline border, sm radius |
| `primaryButtonStyle` | — | Ink 900 background, pill radius, 13px |
| `Toast` | `{ message, type?, onClose }` | Fixed-position toast notification |
| `useToast()` | — | Returns `{ show(msg, type), element }` |
| `ConfirmDialog` | `{ message, onConfirm, onCancel, confirmLabel?, danger? }` | Modal confirm dialog |
| `useConfirm()` | — | Returns `{ confirm(msg, danger?), element }` |
| `ErrorBanner` | `{ message, onRetry? }` | Danger-soft error banner |
| `SkeletonCard` | `{ width?, height? }` | Shimmer loading placeholder |
| `SkeletonRows` | `{ count?, height? }` | Stack of shimmer rows |

### Date Format Rules
- **All displayed dates: DD/MM/YYYY** via `formatDateUK()` from `lib/dateUtils.ts`
- **Date-times:** `formatDateTimeUK()` — DD/MM/YYYY HH:MM
- **Month only:** `formatMonthUK()` — MM/YYYY
- **Database storage:** ISO format (YYYY-MM-DD) — never localise on input
- **NEVER** inline date formatting — always import from `lib/dateUtils.ts`

### Status Colour Map
| Status | Colour |
|--------|--------|
| Completed, Closed, Approved, Resolved, Collected | GREEN `#0F7B5F` |
| In Progress, Pending, Partially Working | AMBER `#B4791F` |
| Submitted | BLUE `#3B4CCA` |
| Waiting Reply, Open, Down, Rejected | RED `#B3261E` |
| Cancelled | SLATE `#64748B` |

---

## 4. Complete Database Schema

> Source of truth: `supabase/` migration files 001–072. All migrations are applied **manually** via the Supabase SQL Editor — never auto-run.

### Core tables

#### `companies`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| name | text NOT NULL | Full company name |
| short_code | text UNIQUE | 'UTPL', 'IFPL' |
| active | boolean | DEFAULT true |
| created_at | timestamptz | DEFAULT now() |

**Data:** UTPL = `15884c2d-48a4-4d43-be90-0ef6e130790c`, IFPL = `77921705-8a15-4406-847a-b234f84b5ec3`

#### `members`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| email | text | Unique, matches Supabase auth |
| name | text | |
| role | text | 'Admin', 'CEO', 'Executive', 'Manager', 'Member' |
| department | text | e.g. 'Finance', 'Unze Trading Ops', 'HR' |
| company | text | Company name (text, legacy) |
| company_id | uuid FK → companies | Added in migration 040 |
| notify_email | boolean | DEFAULT true |
| notify_whatsapp | boolean | DEFAULT false |
| phone_e164 | text | E.164 phone for WhatsApp |
| created_at | timestamptz | |

**RLS:** Admin-tier can write; authenticated can read (restricted by is_privileged for writes).

#### `member_permissions`
Per-member boolean overrides for every permission key. NULL = use role default.
| Column | Type | Override key |
|--------|------|-------------|
| id | uuid PK | |
| member_id | uuid FK → members | ON DELETE CASCADE |
| can_view_executive_dashboard | boolean | |
| can_view_operations_dashboard | boolean | |
| can_view_pa_dashboard | boolean | |
| can_view_finance | boolean | |
| can_edit_finance | boolean | |
| finance_company_scope | text | 'UTPL', 'IFPL', 'both' or NULL |
| can_view_receivables | boolean | |
| can_edit_receivables | boolean | |
| can_see_all_tasks | boolean | |
| can_create_tasks | boolean | |
| can_review_tasks | boolean | |
| can_manage_recurring_tasks | boolean | |
| can_manage_calendar | boolean | |
| can_see_all_minutes | boolean | |
| can_view_dept_ops | boolean | |
| can_view_dept_hr | boolean | |
| can_view_dept_tax | boolean | |
| can_view_dept_audit | boolean | |
| can_view_dept_admin | boolean | |
| can_view_dept_it | boolean | |
| can_view_dept_legal | boolean | |
| can_view_members | boolean | |
| can_add_members | boolean | |
| can_edit_members | boolean | |
| can_delete_members | boolean | |
| can_reset_passwords | boolean | |
| can_view_audit_log | boolean | |
| can_view_exceptions | boolean | |
| can_import_export | boolean | |
| can_access_daily_entry | boolean | |
| can_view_investments | boolean | |
| can_edit_investments | boolean | |
| can_view_stock | boolean | |
| can_manage_stock | boolean | |
| can_view_guarantees | boolean | Added migration 063/068 |
| can_manage_guarantees | boolean | Added migration 068 |
| can_manage_meetings | boolean | Added migration 068 |
| can_view_dept_tax_accounts | boolean | Added migration 070 — NULL defaults to true (all users can view) |
| can_manage_tax_schedule | boolean | Added migration 070 — NULL defaults to false (manage explicitly granted) |
| can_manage_tax_notices | boolean | Added migration 069 — NULL defaults to false |
| created_at | timestamptz | |
| updated_at | timestamptz | |

UNIQUE(member_id). **RLS:** Admin-tier only can read/write.

---

### Finance tables

#### `daily_cash_position`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| company_id | uuid FK → companies | NOT NULL |
| position_date | date | |
| opening_balance | numeric | |
| total_receipts | numeric | |
| total_payments | numeric | |
| closing_balance | numeric | |
| post_dated_total | numeric | |
| closing_after_post_dated | numeric | IFPL: +post_dated; UTPL: −post_dated |
| raw_pdf_filename | text | |
| uploaded_by | text | |
| reconciled | boolean | DEFAULT false |
| created_at | timestamptz | |

**RLS:** `can_see_company_finance(company_id)` — Admin/CEO + scoped Finance managers.
**Pages:** `finance/FinanceManager.tsx` reads and writes.

#### `monthly_cash_plan`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| company_id | uuid FK → companies | |
| plan_month | text | 'YYYY-MM' |
| plan_date | date | Added in 040; backfilled from plan_month |
| planned_receivables | numeric | |
| planned_payouts | numeric | |
| notes | text | |
| created_at | timestamptz | |

**RLS:** Same as daily_cash_position.

#### `cash_opening_balance`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| company_id | uuid FK → companies | |
| balance_date | date | |
| opening_balance | numeric | |
| notes | text | |
| created_at | timestamptz | |

#### `monthly_budgets`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| company_id | uuid FK → companies NOT NULL | |
| budget_month | text | 'YYYY-MM' |
| budget_date | date | Added in 040 |
| category | text | |
| budgeted_amount | numeric | |
| actual_amount | numeric | |
| notes | text | |
| created_at | timestamptz | |

#### `quarterly_forecasts`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| company_id | uuid FK → companies | |
| forecast_quarter | text | e.g. 'Q1-2026' |
| revenue_forecast | numeric | |
| expense_forecast | numeric | |
| notes | text | |
| created_at | timestamptz | |

#### `bank_position_snapshots`
Raw bank account breakdown from PDF uploads.
(all bank account columns — see migration files for full list)

**RLS:** Same as daily_cash_position.

#### `department_budgets`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| company_id | uuid FK → companies NOT NULL | |
| department_name | text | |
| budget_month | text | 'YYYY-MM' |
| budgeted_amount | numeric | |
| actual_amount | numeric | |
| notes | text | |
| created_at | timestamptz | |

#### `opening_balances` / `cash_opening_balance`
Two related tables — `cash_opening_balance` is the newer company-scoped one. See `opening-balances/` page.

---

### Guarantees / Bank Facilities tables (migrations 060–064)

#### `guarantee_facilities`
Bank facility limits per bank.
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| bank_name | text NOT NULL | |
| facility_name | text | |
| facility_type | text | e.g. 'guarantee', 'pay_order' |
| total_limit | numeric | |
| notes | text | |
| active | boolean | DEFAULT true |
| created_at / updated_at | timestamptz | |

#### `guarantees`
Individual guarantee/pay-order records.
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| facility_id | uuid FK → guarantee_facilities | nullable |
| guarantee_type | text | |
| guarantee_number | text | |
| bank_name | text | |
| issue_date | date | |
| expiry_date | date | nullable |
| amount | numeric | |
| cash_margin_pct | numeric | |
| cash_margin_amount | numeric | |
| bank_charges | numeric | |
| customer_name | text | |
| tender_reference | text | nullable |
| purpose | text | nullable |
| status | text | |
| linked_guarantee_id | uuid FK → guarantees | nullable (for Pay Order → Guarantee links) |
| first_bill_receivable_id | uuid FK → receivables | nullable |
| linked_bill_date / linked_invoice_ref / linked_bill_amount | various | Bill link fields |
| performance_bill_date / effective_bill_date / release_due_date / returned_date | date | nullable |
| days_to_expiry | numeric | computed |
| chase_urgency | text | |
| notes | text | nullable |
| created_by / created_at | text / timestamptz | |

**Access:** GET — Admin, CEO, Finance Manager, Ops Manager; POST/PATCH/DELETE — Admin, CEO, Finance Manager only.

---

### Receivables tables

#### `receivable_stages`
9 stages with `working_day_budget` per stage. Seeded in migration 041.

#### `receivables`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| plant_id | uuid FK → plants | |
| bill_number | text | |
| bill_type | text | 'Normal', 'Sales Tax', 'Retention' |
| amount | numeric | |
| issue_date | date | |
| stage_id | uuid FK → receivable_stages | |
| status | text | 'Active', 'Collected' |
| collected_date | date | |
| notes | text | |
| created_at | timestamptz | |

**RLS:** Admin/CEO + Finance managers + Ops managers.

---

### Operations / Production tables

#### `plants`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | text | |
| type | text | |
| active | boolean | |
| created_at | timestamptz | |

#### `member_plants`
Junction: which members are assigned to which plants.

#### `production_entries`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| plant_id | uuid FK → plants | |
| entry_date | date | |
| produced_31 / 36 / 45 / meter | numeric | |
| entered_by | text | |
| created_at | timestamptz | |

**Constraint:** UNIQUE(plant_id, entry_date).

#### `dispatch_entries`
Legacy dispatch table — keeps ops dashboard working.
Same structure as production_entries but dispatched_ columns. UNIQUE(plant_id, entry_date).

#### `breakage_entries`
Same structure; broken_ columns.

#### `scrap_processed_entries`
Scrap/recycled material. scrap_processed column.

#### `broken_opening_balances`
Opening broken stock balances per plant.

#### `machine_issues`
Machine downtime records: plant_name, machine_name, issue_status, issue_description, action_taken, expected_resolution.

#### `monthly_production_targets` / `monthly_dispatch_targets`
Per-plant monthly targets. Fields: plant_id, plant_name, target_month, target_31/36/45/meter.

---

### Stock system tables (migrations 048–059)

Hierarchy: Plant → PurchaseOrder → Contractor → AuthorityLetter → DispatchRecord

#### `purchase_orders`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| plant_id | uuid FK → plants | |
| plant_name | text | Denormalised |
| customer_name | text | |
| po_number | text | UNIQUE with plant_id |
| po_label | text | |
| ordered_31/36/45/meter | numeric | |
| variance_pct | numeric | DEFAULT 3 |
| status | text | 'Active' or 'Closed' |
| is_system_unallocated | boolean | Cannot be deleted/closed |
| start_date | date | |
| opening_produced_31/36/45/meter | numeric | Backfill |
| created_at / updated_at | timestamptz | |

#### `production_allocations`
Links a production_entries row to one PO.

#### `contractors`
Contractor records: name, cnic_or_id, contact_phone, contact_address, notes.

#### `po_contractors`
Junction: PO ↔ Contractor. UNIQUE(po_id, contractor_id).

#### `authority_letters`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| po_id | uuid FK → purchase_orders | |
| contractor_id | uuid FK → contractors | |
| letter_number | text NOT NULL | |
| issue_date | date NOT NULL | |
| expiry_date | date | Added migration 049 |
| issued_by | text NOT NULL | |
| qty_31/36/45/meter | numeric | Authorised quantities |
| opening_dispatched_31/36/45/meter | numeric | Backfill |
| notes / created_by / created_at | various | |

#### `dispatch_records`
Individual pickups against an authority letter.
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| authority_letter_id | uuid FK → authority_letters | |
| dispatch_date | date | |
| qty_31/36/45/meter | numeric | |
| released_by | text NOT NULL | |
| vehicle_number | text | |
| notes / created_by / created_at | various | |

---

### Tasks and meetings tables

#### `tasks`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| task_type | text | |
| description | text NOT NULL | |
| project | text | department / area — required in the New Task form |
| company_id | uuid FK → companies | **Added migration 098.** Null = "Group / needs review". Only UTPL/IFPL/Baranh/Haute Dolci are offered in the New Task form (Almahar/Directors excluded by design) |
| stage | text | **Added migration 098.** Optional free-text pipeline label, separate from status (e.g. "Back to FD Dept") |
| priority | text | 'Urgent', 'High', 'Medium', 'Normal', 'Low' |
| due_date | date | **Required.** Freely editable by anyone with task access — every change is logged automatically (see `task_due_date_history` below) |
| original_due_date | date | **Added migration 098.** Captured once at creation, locked forever by a trigger (`tasks_lock_dates`) — reverts any UPDATE attempt back to the original value, even for Admin |
| assigned_date | date | Set once at creation (today, non-editable in the UI) and locked forever by the same trigger as `original_due_date` |
| assigned_to / assigned_to_email / assigned_to_department | text | |
| assigned_by / assigned_by_email | text | |
| status | text | 'Not Started', 'In Progress', 'Waiting Reply', **'Stuck'** (added — no dedicated colour yet, renders neutral grey), 'Submitted', 'Completed', 'Cancelled'. No DB CHECK constraint — any text is technically insertable, the list above is enforced by the UI only |
| completed_at | timestamptz | **Added migration 098.** Stamped/cleared automatically by a trigger on status transitions into/out of 'Completed' — powers the Team tab's on-time rate |
| completion_notes | text | |
| meeting_id | uuid FK → meetings | |
| time_spent_minutes | int | DEFAULT 0 |
| created_at | timestamptz | |

**A task cannot be set to `status = 'Completed'` at the database level while it has any incomplete row in `task_subtasks`** — enforced by a BEFORE UPDATE trigger (migration 100), not just a disabled button in the UI.

#### `task_subtasks` (migration 100)
One flat checklist level under a task — no nesting. Columns: `id`, `task_id` (FK → tasks, cascade delete), `title`, `is_complete`, `position`, `created_at`, `completed_at` (auto-stamped). RLS mirrors `tasks_select`/`tasks_update` — if you can see/edit the parent task, you can see/edit its subtasks.

#### `task_due_date_history` (migration 099)
Automatic, append-only audit trail of every `due_date` change. Columns: `task_id`, `old_due_date`, `new_due_date`, `changed_by`, `changed_by_email`, `changed_at`. Populated entirely by an AFTER UPDATE trigger on `tasks` (`tasks_log_due_date_change`) — no application code ever writes to this table directly, so it can't be forgotten or bypassed by a future screen. RLS: readable by anyone who can see the parent task; no client insert policy (trigger only, `security definer`).

#### Task summary RPCs (migration 101)
`get_tasks_kpi_summary(p_company_id uuid default null, p_group_only boolean default false)`, `get_tasks_department_breakdown()`, `get_tasks_team_stats()` — replace client-side counting for the Tasks page KPI row, department breakdown, and Team tab. Each is `security definer` and re-implements the exact same visibility rule as the `tasks_select` RLS policy by hand (privileged, or assigned-to-me, or assigned-by-me), since a `security definer` function does not automatically re-apply the caller's RLS.

#### `recurring_tasks`
Templates for recurring task generation. Fields: description, assigned_to/email/dept, frequency ('weekly'/'monthly'/'quarterly'), day_of_week, day_of_month, due_days_after, active.
**RLS (migration 072):** Uses `is_privileged()` — PA (Executive role) can read and write. Previously was `is_admin_or_exec()` which blocked PA since migration 027.
**Now also managed from the Tasks page's Recurring tab** (`RecurringTasksPanel.tsx`, 14/07/2026) — same table, same CRUD, same cron engine, just reachable from `/tasks` as well as the standalone `/recurring-tasks` page (which still works unchanged).

#### Task monthly/quarterly chart RPCs (migration 102)
`get_tasks_monthly_chart(p_company_id uuid default null, p_group_only boolean default false)` and `get_tasks_quarterly_chart(...)` — replace the client-side for-loops that used to build the Monthly ("Created vs Completed") and Quarterly (overdue/active/completed) bar chart data in `TasksList.tsx`. Same visibility rule and Company-filter params as the migration 101 RPCs.

#### `meetings`
fields: meeting_date, title, company, department, executive_summary, decisions, risks, opportunities, attendees (jsonb), raw_transcript, created_by.

#### `meeting_attendees`, `meeting_tasks`, `pending_minutes`
Supporting meeting tables. See migration files.

#### Tasks page redesign (14/07/2026) — what shipped and what didn't
Real code, not just the design mockup (`Tasks_Page_Mockup.html`, still a standalone reference file, not wired into the app): `NewTaskForm.tsx` (required Company tag, locked assigned date, inline subtasks, Stage, Urgent priority, Stuck status), `TaskStatus.tsx` (subtasks checklist with completion gating, Stage editing, due-date history + locked original date), `TasksList.tsx` (company badges, Company filter + Reset Filters, RPC-sourced KPI row incl. Due Today/Stuck, new Team tab via `TeamStats.tsx`).

**Phase 4 (same day, 14/07/2026) — the three items deferred above, now done:**
- **Stuck status is now red** — Khuram: "Stuck means red alert." Distinguished from Waiting Reply (also red) by a dashed border on the Stuck badge (`statusColor()`/`StatusBadge` in `SharedUI.tsx`).
- **Drag-and-drop Kanban board** — new Board tab (`TasksBoard.tsx`), native HTML5 drag-and-drop, one column per status. Moving a card to Completed while subtasks are open is rejected by the migration-100 database trigger; the rejection surfaces as a toast. The task detail view was extracted out of the List row into a shared `TaskDetailPanel.tsx` so List and Board use one implementation.
- **Recurring Tasks merged in** — new Recurring tab (`RecurringTasksPanel.tsx`), same `recurring_tasks` table and cron engine as the standalone `/recurring-tasks` page (which still exists and still works — nothing there was removed).
- **Monthly/quarterly charts moved to RPCs** — migration 102 (`get_tasks_monthly_chart`, `get_tasks_quarterly_chart`) replaces the JS for-loops that used to build this chart data. Department/weekly/timeline grouping still runs client-side over the full row list on purpose — those views render individual tasks, not just counts, so they still need the full list either way.

Migrations 098–105 all still need to be run by hand in the Supabase SQL Editor if that hasn't happened yet — see the note at the top of each `.sql` file for the exact order.

**Phase 5 (14/07/2026) — mockup reconciliation, after Khuram flagged the live page was missing most of the finalised design.** The Phase 3/4 report understated the gap: only three items were called out as deferred, when in fact a much larger set of mockup features had quietly not made it into the real build (attention banner, My Tasks view, most filters, search, the modal detail pattern, mini-checklist, comments, WhatsApp toggle, calendar picker, meeting chip, and a Company field that wasn't genuinely required). This phase closes all of it:

- **Company is now genuinely required** on `NewTaskForm.tsx` — previously defaulted silently to "Group / needs review" and would save without ever being touched; now starts on a disabled placeholder and won't submit until actively chosen.
- **"Needs Your Attention" banner** — Critical (Urgent, open) / Overdue / Due Today / Stuck stat row plus a "View breakdown" drawer, finally wiring `get_tasks_department_breakdown()` (built in migration 101, unused until now) into the UI. Migration 103 adds `urgent_open_count` to `get_tasks_kpi_summary()` for the Critical stat.
- **"My Tasks" tab**, now the default landing view — grouped Overdue / Due Today / This Week / Next Week & Later, with a My tasks/Everyone scope toggle.
- **Department, Priority, Owner filters + a "More Filters" panel** (Stage, Due date, Source, Subtask state) on Board/List — all genuinely functional client-side filters over the fetched rows (not aggregation, so this doesn't conflict with house rule 0).
- **Search box** over task descriptions.
- **Task detail is now a modal popup** (`TaskDetailModal.tsx` + `app/lib/Modal.tsx`) instead of an inline expand-in-row/card panel, matching the finalised design. `TaskDetailPanel.tsx` itself is unchanged internally, just wrapped.
- **Inline mini-subtask-checklist** (`MiniSubtaskToggle.tsx`) — a quick tick-off caret on List rows and Board cards, separate from opening the full modal, reading/writing the same `task_subtasks` rows so it can never drift out of sync the way the mockup's demo copies honestly couldn't.
- **Comments** (migration 104, new `task_comments` table) — flat, oldest-first, append-only, RLS mirrors `tasks_select`.
- **WhatsApp auto-remind toggle** (migration 105, `tasks.whatsapp_auto_remind`) — captures intent only; still needs the pending WhatsApp Business API setup before anything actually auto-sends.
- **Calendar-popover date picker** (`app/lib/DateInputWithCalendar.tsx`) — adds a "Pick" button + popover calendar alongside the existing `DateInput` text field on the New Task due date and the current-due-date editor. Still not a native `<input type="date">`, per house rules.
- **Meeting-source chip** on List rows and Board cards — a compact "From: [meeting title] →" chip, not just a link buried inside the full detail view.

Migrations 103–105 need to be run after 098–102, same manual process.

**Phase 6 (14/07/2026) — second live-testing feedback round.** Two rounds of feedback after Khuram tried the live page, back to back:

*Round 1 (9 points):* one attention banner instead of two; every KPI tile clickable to a drawer of matching tasks (not just Open/Overdue); recurring templates editable (`RecurringTasksPanel.tsx`); core-field edit (description/priority/department/company) added to regular tasks via `TaskDetailPanel.tsx` (the `canEditTask` prop on `TaskStatus.tsx` had existed with no UI wired to it); People/Owner filter made visible on every tab, not just Board/Weekly/Department; Escape key closes `Modal.tsx` and `DateInputWithCalendar.tsx`; KPI tiles gained small icon squares (inline SVG, no new dependency); Department tab dropped (the reference image was actually the Board Kanban layout). Migration 106 backfills `company_id`/department on the 77 pre-redesign tasks — priority and owner were deliberately **not** touched, since a live query showed both were already fully populated with real values.

*Round 2 (Khuram's next message, same day):* Recurring Tasks and Calendar removed from the sidebar (`pageRegistry.ts`) — Recurring lives inside Tasks now, Calendar is hidden everywhere until it's finished; Profile moved from My Workspace to Settings. Task description capped at 150 characters (`TASK_DESCRIPTION_LIMIT` in `SharedUI.tsx`, applied in `NewTaskForm.tsx`, `TaskDetailPanel.tsx`'s edit form, and `RecurringTasksPanel.tsx`) — CSV import and meeting-action-item creation deliberately left uncapped, those are separate flows. Overdue task rows no longer get a full red background (was "cramped and messy" per Khuram) — replaced with a left accent bar + a small "Overdue" pill badge, full-row tint removed from `TaskRow` in `TasksList.tsx`. Migration 107 adds the 7 departments Khuram listed that were missing from `department_owners` (Accounts, Tax, Retail, Marketing, Online, Executive Office, Procurement / Purchase) — owners left blank for Khuram to assign via Members; 5 existing departments not on his list (BINC, Legal, S&M Investment, Sales, Unze Trading Ops) were left untouched, not deleted.

**View switcher rebuilt** — Weekly/Monthly/Quarterly tabs (and their bar charts) removed entirely; replaced with a single "Due period" filter (All/This week/this month/this quarter, calendar-based boundaries) available alongside the other filters on every tab. `get_tasks_monthly_chart()`/`get_tasks_quarterly_chart()` (migration 102) are still in the database but no longer called from anywhere — safe to ignore, not worth a migration to drop them. Board/Tree/List/Timeline are now icon-only buttons (right-aligned); Team/Recurring stay as plain text pills (left-aligned) since they aren't task-list views. "List" is the old "My Tasks" tab, renamed. "Tree" is the old Department view brought back with an actual two-level collapsible hierarchy (Department → Person → Tasks), not just a flat list with a non-collapsible person strip.

Migrations 106–107 need to be run after 098–105, same manual process — check the note at the top of each file.

---

### Notification tables

#### `notification_log`
Tracks sent emails and WhatsApp messages: recipient_email, channel, subject, trigger_type, status.

#### `push_subscriptions`
Web push registration: email, endpoint, p256dh, auth. RLS: own email only.

---

### Google OAuth table

#### `google_oauth_tokens`
Encrypted tokens for Google integration. Admin-tier only.
Single account: k.saleem@unzegroup.com handles calendar, Gmail read, outbound notifications, backup.

---

### Investment tables

#### `holdings`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| ticker | text NOT NULL | PSX ticker |
| company_name | text | |
| quantity | numeric NOT NULL | |
| buy_price | numeric NOT NULL | |
| buy_date | date | |
| target_price | numeric | |
| notes | text | |
| created_at | timestamptz | |

**RLS:** CEO/Admin only.

#### `price_history`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| ticker | text NOT NULL | |
| price | numeric NOT NULL | |
| as_of_date | date NOT NULL | |
| source | text | 'psx_dps', 'yahoo', 'manual' |
| created_at | timestamptz | |

**Constraint:** UNIQUE(ticker, as_of_date).

#### `stock_dividends` — migration 065
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| ticker | text NOT NULL | |
| dividend_per_share | numeric(12,4) NOT NULL | |
| ex_dividend_date | date NOT NULL | |
| payment_date | date | |
| announced_date | date | |
| status | text | 'upcoming', 'paid', 'cancelled' |
| source | text | 'manual', 'auto-psx', 'auto-company-site' |
| confirmed | boolean NOT NULL DEFAULT false | true = manual/verified |
| notes | text | |
| entered_by | text | |
| entered_at | timestamptz | |

**Constraint:** UNIQUE(ticker, ex_dividend_date). Confirmed entries never overwritten by auto-fetch.

#### `portfolio_snapshots` — migration 066
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| snapshot_date | date NOT NULL | |
| ticker | text NOT NULL | |
| total_qty / total_cost / current_price / current_value / gain_loss / gain_loss_pct | numeric | |
| created_at | timestamptz | |

**Constraint:** UNIQUE(snapshot_date, ticker). Written by daily-summary cron each weekday.

#### `pension_funds` — (applied directly)
Active UK pension funds tracked. Columns: id, fund_name, isin, morningstar_id, active (boolean), notes.

#### `pension_fund_prices` — (applied directly)
Daily price records for pension funds. Columns: id, fund_id (FK → pension_funds), price_date, price_gbp, source. UNIQUE(fund_id, price_date). Written by the `fetch-pension-prices` cron.

#### Views (legacy — not used by live app)
- `current_prices` — latest price per ticker
- `portfolio_summary` — joins holdings with current_prices

---

### Folderit DMS tables (migrations 074–089, 095)

Folderit is the group's Document Management System. The dashboard (read-only) syncs inbox and approval state from Folderit's API every 30 minutes.

#### `folderit_account_map`
Maps Folderit accounts to companies.
| Column | Type | Notes |
|--------|------|-------|
| account_uid | text PK | Folderit account UID |
| account_name | text | Display name from Folderit |
| company_uuid | uuid FK → companies | null for scope='global'/'excluded'/'pending' |
| scope | text | CHECK IN ('company','global','excluded','pending') |
| inbox_folder_uid | text | Folderit inbox folder UID |
| is_active | boolean | DEFAULT true |
| updated_at | timestamptz | |

**Account mapping:**
| Folderit UID | Account | Company | Scope |
|---|---|---|---|
| pNeZ609Mgw | Unze Trading | UTPL | company |
| YUsup0PqWr | Imperial Footwear | IFPL | company |
| 6cVIn0up6S | Unze London | IFPL | company |
| B9jVq0_u1U | Restaurants | BRNH | company |
| dYjdc0Ev6N | Family Documents | DIR | company |
| 2ztVT0f2yX | Human Resource | — | global |
| fEKAm0deuD | S&W London | — | excluded |
| JsXvG0hu5g | S&M Investments | — | pending |

Haute Dolci (HD) and Almahar (ALM) have no Folderit account yet — their counts read 0 until mapped.

#### `folderit_inbox_files`
Files currently in a mail-in inbox, not yet filed.
| Column | Notes |
|--------|-------|
| file_uid | PK |
| account_uid | FK → folderit_account_map |
| name | Filename |
| created_at, synced_at | timestamps |

#### `folderit_resolution_invites`
Per-person approval tasks (Folderit "resolution invite" objects).
| Column | Notes |
|--------|-------|
| invite_uid | PK |
| resolution_uid, file_uid, entity_uid | Folderit references |
| account_uid | FK → folderit_account_map |
| email | Person the invite is for |
| status | pending \| pendingInvite \| active \| approved \| rejected |
| invite_order | integer |
| synced_at | timestamp |

#### `folderit_hr_categories`
HR sub-categories within the HR account (e.g. "Policies & SOPs").
Columns: category_name PK, display_name, sort_order, is_active.

#### `folderit_hr_category_files`
Files belonging to each HR category.
Columns: file_uid PK, category_name FK, name, created_at, synced_at.

#### `folderit_email_aliases`
Email aliases for Folderit accounts (maps Folderit email → member email).
Columns: id, folderit_email, member_email, notes.

---

### Tax Accounts tables (migrations 069–071)

#### `tax_schedule_entries` — migration 070
Tracks completion status of each step in the quarterly and annual accounts schedule.
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| tax_year | text NOT NULL | e.g. '2025-26' (Pakistan fiscal year Jul–Jun) |
| section | text NOT NULL | CHECK IN ('Q1','Q2','Q3','Q4','Annual') |
| step_index | integer NOT NULL | CHECK BETWEEN 1 AND 6 |
| entity_key | text NOT NULL | e.g. 'UT', 'IMP', 'BARANH', 'HD', 'ALMAHAR', 'K_SALEEM', etc. |
| status | text NOT NULL DEFAULT 'Not Started' | CHECK IN ('Not Started','In Progress','External Auditors','Completed') |
| updated_by | text | Email of last editor |
| updated_at | timestamptz | |

**Constraint:** UNIQUE(tax_year, section, step_index, entity_key).
**Index:** idx_tax_schedule_year on (tax_year).
**RLS:** Authenticated read; any authenticated write (rows belong to the organisation, not a user).

**Quarterly entities (Q1–Q4):** UT, IMP, BARANH, HD, ALMAHAR (5 entities × 5 steps = 25 slots per quarter).
**Annual entities:** UT, IMP, BARANH, HD, ALMAHAR, KK_JHANG, K_SALEEM, KA_SALEEM, W_SALEEM, SH_SALEEM (10 entities × 6 steps = 60 slots).

#### `tax_return_filings` — migration 070
Tracks whether each monthly or quarterly tax return has been filed.
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| tax_year | text NOT NULL | |
| return_type | text NOT NULL | CHECK IN ('FBR_SALES_TAX','PRA_TAX','INCOME_TAX') |
| entity_key | text NOT NULL | |
| period_key | text NOT NULL | 'YYYY-MM' for monthly; 'Q1'–'Q4' for quarterly Income Tax |
| filed | boolean NOT NULL DEFAULT false | |
| filed_at | timestamptz | |
| filed_by | text | |
| updated_at | timestamptz | |

**Constraint:** UNIQUE(tax_year, return_type, entity_key, period_key).
**Index:** idx_tax_return_year on (tax_year).

**Return types and entities:**
- FBR Sales Tax (monthly): UT, IMP, ALMAHAR
- PRA Tax (monthly): UT, IMP, BARANH, HD, ALMAHAR
- Income Tax (quarterly): UT, IMP, BARANH, HD, ALMAHAR

#### `tax_deadline_alerts` — migration 071
Pre-computed two-tier deadline alerts — written by `taxAlertEngine.ts` via the cron.
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| tax_year | text NOT NULL | |
| alert_type | text NOT NULL | e.g. 'schedule_q1', 'monthly_fbr', 'annual_personal' |
| period_key | text NOT NULL | Quarter or month string |
| tier | integer NOT NULL | CHECK IN (1, 2) — 1=first warning, 2=overdue |
| overdue_count | integer NOT NULL DEFAULT 0 | |
| alert_message | text NOT NULL | |
| resolved | boolean NOT NULL DEFAULT false | |
| first_triggered_at | timestamptz | |
| last_checked_at | timestamptz | |
| resolved_at | timestamptz | |

**Constraint:** UNIQUE(tax_year, alert_type, period_key, tier).
**Index:** idx_tax_deadline_alerts_active on (resolved, tier, tax_year).
**RLS:** Authenticated read; authenticated write (cron writes via service client, but policy allows authenticated).

#### `legal_notices` (enhanced — migration 069)
Existing table for tax notices and legal notices. New columns added:
| Column | Type | Notes |
|--------|------|-------|
| is_active | boolean NOT NULL DEFAULT true | Active/Inactive filter |
| notice_status | text | CHECK IN ('Order','Notice','Show Cause') |
| legal_stage | text | CHECK IN ('Authority','Department','CIR Appeal','Tribunal','High Court','Supreme Court') |

**New permission:** `can_manage_tax_notices` in member_permissions — defaults to NULL (false). Granted to Khuram, Shakeel, Avess/Awais. Gated by `canManageTaxNotices()` in permissions.ts.

---

### Postgres RPC Functions (performance layer)

These functions run entirely in Postgres and return pre-aggregated results.

#### `get_portfolio_summary_full(p_as_of date, p_alert_pct numeric, p_div_days int)` — migration 067
Returns a single JSONB object: totals (total_cost, total_value, gain_loss, gain_loss_pct, stock_count, price_date, prev_value, day_change, day_change_pct, dividend_count), stocks (per-ticker array), losers (stocks below alert threshold).
**Used by:** `app/investments/page.tsx`, `app/home/page.tsx`.

#### `get_portfolio_daily_summary(p_as_of, p_prev_date, p_alert_pct, p_div_days)` — migration 066
Full JSONB summary for the daily-summary cron only. Not called from any page.

#### `get_upcoming_dividends(p_days_ahead int)` — migration 065
Confirmed + unconfirmed dividends joined with holdings (total_qty, estimated_payout, days_to_ex).
**Used by:** `/api/investments/dividends?mode=upcoming`, `app/pa/page.tsx`.

#### `get_plant_kpis(as_of_date date, month_start date, month_end date)` — migration 055
Returns one row per active plant with opening balances, cumulative totals, on-date totals, MTD totals. Replaces 7 raw table fetches.
**Used by:** `app/home/page.tsx`, `app/dashboard/DashboardView.tsx`.

#### `get_receivable_rag_by_customer()` — migration 056
One row per customer with green/amber/red amounts. RAG computed in Postgres using working-day arithmetic.
**Used by:** `app/home/page.tsx`.

#### `get_receivable_aging_totals()` — migration 056
4 rows (0–30, 31–60, 61–90, 90+) with total PKR per bucket.

#### `get_receivable_aging_by_customer()` — migration 056
One row per customer with b0_30, b31_60, b61_90, b90_plus, total columns.

#### `get_pension_summary()` — (no migration number — applied directly)
Returns a single row: `{ total_value_gbp, net_gain_gbp, return_pct, contributed_gbp, fees_gbp, fund_count, last_price_date }`.
**Used by:** `app/investments/page.tsx`, `app/home/page.tsx` (via sessionStorage cache).

#### `get_pension_fund_breakdown()` — migration 073 (updated from original direct apply)
Returns one row per fund: `{ fund_name, isin, units_held, price_gbp, value_gbp, allocation_pct, price_date, risk_rating, ongoing_charge_pct, benchmark, return_1m_pct, return_3m_pct, return_6m_pct, return_1y_pct, return_5y_pct, factsheet_date, factsheet_notes }`. Factsheet fields added in 073.
**Used by:** `app/investments/page.tsx`.

#### `get_folderit_summary(p_user_email, p_company_uuid)` — migration 074
Returns `{ pending_approval_count, company_inbox_count, hr_inbox_count }`. Used for home page/sidebar badges. CEO/Admin pass nulls for both params (no filter); other callers pass their own email/company.
**Used by:** `/api/folderit/summary`.

#### `get_folderit_company_breakdown()` — migration 076
One row per company: `{ company_uuid, inbox_count, pending_approval_count }`. Admin/CEO view — all companies.
**Used by:** `/api/folderit/company-breakdown`.

#### `get_folderit_hr_categories()` — migration 076
One row per active HR category: `{ category_name, file_count, sort_order }`.
**Used by:** `/api/folderit/hr-summary`.

#### `get_folderit_hr_category_files(p_category_name)` — migration 076
Files in a specific HR category: `{ file_uid, name, created_at }`.

#### `get_folderit_details(p_user_email, p_company_uuid, p_include_company_inbox)` — migration 074 + 077
Detail drill-down: approval items, company inbox files, HR inbox files. Scoped by caller.
**Used by:** `/api/folderit/details`.

#### `get_folderit_hr_inbox()` — migration 083
HR inbox files (HR account's own inbox, separate from HR category files).
**Used by:** `/api/folderit/hr-inbox`.

#### `search_folderit_hr_files(p_query)` — migration 086
Searches HR category files + HR inbox files by filename. Returns `{ file_uid, name, source, created_at }`.
**Used by:** `/api/folderit/hr-search`.

#### `search_folderit_inbox(p_query, p_company_uuid)` — migration 095
Searches company inbox files by filename. `p_company_uuid = NULL` = all companies (Admin/CEO only). Scoped via `folderit_account_companies` — HR account and excluded/pending accounts naturally excluded.
**Used by:** `/api/folderit/search`.

#### `get_folderit_overdue_items(p_threshold_days)` — migration 079
Files/approvals overdue for filing/action beyond threshold days.
**Used by:** `/api/folderit/overdue`.

#### `get_ceo_daily_digest(p_emails text[])` — migration 080
Returns JSONB: open tasks, overdue task count, escalations, Folderit pending approvals. Assembled in one Postgres round-trip. Called by the CEO digest cron (never from browser pages).
**Used by:** `/api/notifications/ceo-digest`.

**Security:** All RPCs use `security definer` + `set search_path = public`. Accessible to `authenticated` role only. Migrations 092–093 revoked the default PUBLIC EXECUTE grant from all data-returning RPCs — anon callers now get permission-denied. Migrations 090–091 fixed `multiple_permissive_policies` and `auth_rls_initplan` RLS performance warnings.

---

### Department tables

#### `audit_plan_items` / `audit_findings`
Audit planning and findings. See migration files.

#### `recruitment_positions` / `performance_evaluations` / `hr_strategy_goals`
HR tables. See migration files.

#### `legal_notices`
Legal and tax notices. notice_type IN ('legal','tax'). Enhanced with is_active, notice_status, legal_stage (migration 069).

#### `admin_categories` / `admin_spend`
Admin department budget tracking.

---

### Other tables

#### `leave_records`
Leave tracking per member.

#### `audit_log`
System activity trail: user_email, action, table_name, record_id, details.

#### `app_settings`
Key/value store: e.g. 'drive_inbox_folder_id', 'drive_processed_folder_id'.
**RLS:** Service role only.

#### `document_archive`
Source document archive: doc_type, company_id, position_date, storage_path, original_filename, source.

#### `department_owners`
Maps departments to responsible members.

#### `meeting_requests`
Calendar/meeting request tracking.

---

## 5. Role and Permission System

### Roles

| Role | Who | Key constraints |
|------|-----|-----------------|
| **Admin** | khuram1901@gmail.com | Locked, undeletable, role unchangeable. Sees and can do everything |
| **CEO** | k.saleem@unzegroup.com | Same powers as Admin. Different home page (CEO briefing). Locked |
| **Executive** (= PA) | pa.ceo@unze.co.uk (Sundas) | Almost-admin but **never** sees Finance, Receivables, or Executive Dashboard. Role locked |
| **Manager** | Department-scoped | Finance dept → finance pages. Ops dept → ops/production/stock |
| **Member** | Any staff | Own tasks + profile only |

### Identity Helpers (permissions.ts)
- `isCEO(ctx)` — email === 'k.saleem@unzegroup.com'
- `isMainAdmin(ctx)` — email === 'khuram1901@gmail.com'
- `isPA(ctx)` — email === 'pa.ceo@unze.co.uk' OR role === 'Executive'
- `isAdminTier(ctx)` — CEO + Admin + role 'Admin'. **NOT Executive**
- `isPrivileged(ctx)` — isAdminTier OR role 'Executive' (includes PA)

### Override System
`member_permissions` table stores per-member boolean overrides (NULL = use role default, true/false = override). Checked via `ov(ctx, key)` in every permission function. The Access Matrix UI at `/members` lets Admin toggle these.

### Permission Functions (permissions.ts)

| Function | Returns true for | permKey |
|----------|-----------------|---------|
| `canViewFinance` | Admin/CEO + Finance Managers (NOT PA) | can_view_finance |
| `canEditFinance` | Same as canViewFinance | can_edit_finance |
| `canViewReceivables` | Admin/CEO + Finance Mgrs + Ops Mgrs (NOT PA) | can_view_receivables |
| `canEditReceivables` | Ops dept ONLY | can_edit_receivables |
| `canViewExecutiveDashboard` | Admin/CEO ONLY | can_view_executive_dashboard |
| `canViewOperations` | Admin/CEO + Ops dept | can_view_operations_dashboard |
| `canViewStock` | Admin/CEO + Ops dept | can_view_stock |
| `canManageStock` | Admin/CEO + Ops Managers | can_manage_stock |
| `canSeeAllTasks` | Privileged (Admin/CEO/PA) | can_see_all_tasks |
| `canCreateAssignments` | Privileged + Ops Managers | can_create_tasks |
| `canReviewTasks` | Privileged | can_review_tasks |
| `canManageRecurringTasks` | Privileged | can_manage_recurring_tasks |
| `canManageCalendarRequests` | Privileged | can_manage_calendar |
| `canSeeAllMinutes` | Privileged | can_see_all_minutes |
| `canManageMembers` | Privileged | can_view_members |
| `canAddMembers` | Privileged | can_add_members |
| `canViewAuditLog` | Privileged | can_view_audit_log |
| `canViewExceptions` | Privileged | can_view_exceptions |
| `canImportExport` | Privileged | can_import_export |
| `canAccessDailyEntry` | Admin/CEO + Ops dept | can_access_daily_entry |
| `canViewInvestments` | CEO + Admin (by email) + PA (view-only) | can_view_investments |
| `canEditInvestments` | CEO + Admin by email only (NOT PA) | can_edit_investments |
| `canViewPADashboard` | PA + Admin/CEO | can_view_pa_dashboard |
| `canViewDepartment(dept)` | Admin/CEO + Manager of that dept (NOT PA) | can_view_dept_* |
| `canViewGuarantees` | Admin/CEO + Finance Mgr + Ops Mgr (all via override) | can_view_guarantees |
| `canManageGuarantees` | Admin/CEO + Finance Mgr | can_manage_guarantees |
| `canViewTaxAccounts` | All authenticated users (NOT PA). Defaults true when NULL | can_view_dept_tax_accounts |
| `canManageTaxSchedule` | Admin/CEO only. Defaults false when NULL | can_manage_tax_schedule |
| `canManageTaxNotices` | Admin/CEO + explicitly granted (Shakeel, Avess/Awais). Defaults false | can_manage_tax_notices |
| `canEditOperationsTargets` | Privileged + Ops HoD (nadeem.khan@unze.co.uk) | — |

### Finance Company Scoping
`financeCompanies(ctx)` returns 'UTPL', 'IFPL', 'both', or 'none' based on company association.

### Task Ownership Rules
- **Protected tasks**: created by Admin/CEO/PA — assignees can only update status and add notes
- **Self-assigned tasks**: full control
- `isTaskProtected(email)` / `canEditTask(ctx, email)` / `canDeleteTask(ctx, email)`

### Member Administration Rules
- `assignableRoles(ctx)`: Admin-tier → all roles; Executive → Manager/Member only
- `canEditMember` / `canDeleteMember` — LOCKED_EMAILS / PROTECTED_EMAILS constraints

### RLS Functions (Supabase)
| Function | Description |
|----------|-------------|
| `is_admin_tier()` | CEO/Admin email OR role='Admin' |
| `is_admin_or_exec()` | Alias for is_admin_tier() (Executive deliberately excluded post-migration 027) |
| `is_privileged()` | is_admin_tier() OR role='Executive' |
| `is_finance_manager()` | role='Manager' AND department='Finance' |
| `is_ops_manager()` | role='Manager' AND department='Unze Trading Ops' |
| `can_see_company_finance(uuid)` | Admin-tier OR scoped Finance manager for that company |

### API-Level Security (Bank Facilities routes — hardened 05/07/2026)
| Route | Method | Allowed roles |
|-------|--------|---------------|
| `/api/finance/guarantees` | GET | Admin, CEO, Finance Manager, Ops Manager |
| `/api/finance/guarantees` | POST / PATCH / DELETE | Admin, CEO, Finance Manager only |
| `/api/finance/guarantee-facilities` | All methods | Admin, CEO, Finance Manager only |

---

## 6. Sidebar Structure

**SIDEBAR_GROUPS order:** Overview → Operations → Departments → Finance → My Workspace → Settings

Items within each group are sorted A–Z case-insensitively at render time.

### Overview (always visible)
- Executive Dashboard (`/home`) — or `/pa` for PA users

### Operations
- Daily Entry (`/production`)
- Manage POs (`/stock/manage`)
- Operations Dashboard (`/dashboard`)
- Stock (`/stock`)

### Departments (A–Z)
- Admin (`/department/admin`)
- Audit (`/department/audit`)
- HR (`/department/hr`)
- IT (`/department/it`)
- Tax Notices (`/department/taxation`) — was "Taxation"; sidebar label renamed "Tax Notices"
- Accounts & Returns (`/accounts-tax`) — NEW: quarterly accounts schedule + return filings

### Finance (A–Z)
- Bank Facilities (`/finance/guarantees`)
- Documents (`/folderit`) — Folderit DMS status (inbox + approvals)
- Imperial Footwear (`/finance/imperial`)
- Investments (`/investments`)
- Opening Balances (`/opening-balances`)
- Receivables (`/receivables`)
- Unze Trading (`/finance/unze-trading`)

### My Workspace (was "Tasks & Meetings" — A–Z)
- Meetings (`/meetings`)
- My Minutes (`/my-minutes`)
- Tasks (`/tasks`)

Calendar and Recurring Tasks were removed from the sidebar (14/07/2026) — Calendar hidden for everyone until it's finished (route still exists at `/calendar`, just unlinked), Recurring Tasks merged into the Tasks page's Recurring tab (the standalone `/recurring-tasks` route still works, just not linked here either).

### Settings
- Members (`/members`)
- Exceptions (`/exceptions`)
- Audit Log (`/audit-log`)
- Data & Backups (`/admin`) — Admin only
- Profile (`/profile`) — moved here from My Workspace (14/07/2026)

### Nav active state
NAVY background + white text. **Blue left accent bar (3px solid COLOURS.BLUE)** on active items in expanded state (3px transparent when collapsed). Items collapsed to icon-only when sidebar is collapsed.

---

## 7. Every Page and Workflow

### Public pages (no authentication)

#### `/login`
Supabase email + password. Time-based greeting, crossfade carousel. On success → `/home` (or `/pa` for PA).

#### `/forgot-password` / `/reset-password`
Password reset flow via Supabase.

---

### Authenticated pages

#### `/home`
- **File:** `app/home/page.tsx`
- **Access:** All authenticated users (PA auto-redirects to `/pa`)
- **What it does:**
  - Shows PAGE_REGISTRY cards grouped by section
  - CEO/Admin: greeting strip, Quick task actions
  - **Tax Compliance summary card**: shows filing % and schedule completion for current and previous fiscal year. Clickable → navigates to `/accounts-tax`. Only shown when `taxScheduleEntries` / `taxReturnFilings` data exists from DB.
  - **Investments card**: total cost, current value, gain/loss, return %. Amber "X dividends due this week" badge when confirmed dividends due within 7 days.
  - Cron health panel (Admin only)
  - Manager briefings (Ops Manager / Finance Manager — collapsible)
  - Notification bell badges update in real-time
- **Date selector (CEO/Admin):** View dashboard as of any date up to 90 days back. All data sections respect selected date.
- **Performance:** 2-minute sessionStorage cache per date key. Cache busted on Supabase Realtime changes.

#### `/my-dashboard`
Personal task summary — own tasks by status.

#### `/profile`
Change display name, password, notification preferences.

#### `/pa`
- **File:** `app/pa/page.tsx`
- **Access:** PA (Sundas) + Admin/CEO
- **What it does:** PA operating hub — tasks, notes, delegations, calendar appointments.
  - **Dividend calendar** (confirmed only): ticker, ex-date, payment date, days badge. No financial figures.

#### `/accounts-tax` — NEW
- **File:** `app/accounts-tax/page.tsx` → `AccountsTaxDashboard.tsx`
- **Access:** All authenticated users (NOT PA). Manage restricted to Admin/CEO + explicitly granted.
- **What it does:**
  - **Quarterly Accounts Schedule**: fiscal-year navigation (e.g. '2025-26'). Four quarters (Q1 Jul–Sep, Q2 Oct–Dec, Q3 Jan–Mar, Q4 Apr–Jun). Per-quarter: 5 entities (UT, IMP, BARANH, HD, ALMAHAR) × 5 steps = 25 check boxes. Steps: Record keeping of accounts → Recording in Sage → Record verification by external auditor → Preparation of accounts → Handover to external auditor.
  - **Annual Accounts Schedule**: 10 entities × 6 steps = 60 checkboxes. Steps: Bookkeeping → Recording in Sage → Preparation of accounts → Handing over to external auditor → Consulting with consultant → Final submission.
  - **Return Filings grid**: FBR Sales Tax (monthly, 3 entities), PRA Tax (monthly, 5 entities), Income Tax (quarterly, 5 entities). Checkboxes per period. Overdue detection: returns unfiled after the 15th of the following month/quarter are marked overdue.
  - **Status options**: Not Started (default), In Progress, External Auditors, Completed.
  - **Fiscal year logic**: Pakistan fiscal year Jul–Jun. Q1 = Jul–Sep, Q4 = Apr–Jun. Fiscal year string format: '2025-26'.
  - After each save, fires POST to `/api/cron/tax-alerts` to recompute deadline alerts in the background.
- **Linked to home page:** `TaxComplianceSummary` component on CEO home page shows a clickable summary tile.

#### `/dashboard`
Operations Dashboard — per-plant KPI cards, charts, stock by PO, machine issues, breakage pareto. Full Genspark restyle.

#### `/finance`
Company picker → UTPL / IFPL. Department budgets. Bulk upload. Full Genspark restyle.

#### `/finance/[company]`
Per-company finance dashboard: cash position, cash plan, budgets, charts. Full Genspark restyle.

#### `/finance/guarantees`
Bank Facilities — guarantee records grouped by bank, facility utilisation bars, pay order tracking, bill linking, chase urgency, expiry tracking.

#### `/receivables`
Kanban pipeline — drag-and-drop bills through collection stages. Inline edit/delete. Stage header colour corrected: `color: "#fff"` → `color: "white"` (string literal, not hex — avoid raw values in inline styles).

#### `/investments`
PSX portfolio. Holdings table, P&L, dividend tracking (confirmed + unconfirmed), Today's Change card, price history chart. Historical date picker.

#### `/opening-balances`
Set starting cash balances per company.

#### `/production`
Daily entry: production qty + PO allocation, dispatch (authority letter lookup → dual write), breakage, machine issues, quick-add receivables.

**Dispatch safety rules (as of 2026-07-08):**
- "Nothing to report" button requires confirmation if active authority letters with remaining balance exist for the plant.
- Submit Dispatch button is disabled when quantities are entered but no authority letter is selected.
- Informational message shown when no active letters exist: *"No active authority letters — only 'Nothing to report' can be recorded for this plant today."*
- Server-side hard block in `/api/stock/dispatch-records`: dispatch rejected if it would exceed the letter's remaining balance (over-quantity check).
- Server-side expiry check in `/api/stock/authority-letters`: expired letters are flagged; dispatching against expired letters is blocked.

#### `/stock`
Collapsible tree: Plant → PO → Contractor → Letter → balances. PO delivery forecast badges. Letter expiry badges.

#### `/stock/manage`
Create POs, authority letters, contractors. Close PO action. Edit permissions for Ops Managers.

#### `/tasks`
All users. List/Board/Tree/Timeline icon view switcher (Team/Recurring as separate pills), Due period filter (week/month/quarter) instead of separate tabs. Protected task ownership rules.

#### `/calendar`
Tasks by due date in calendar layout. Hidden from the sidebar (14/07/2026) until finished — still reachable directly at `/calendar`.

#### `/meetings`
Past Meetings tab + Decision Log tab. AI extraction via Claude. Meeting Action Tracker.

#### `/my-minutes`
Personal meeting minutes. Copy protection for non-privileged users.

#### `/recurring-tasks`
Recurring task templates. PA (Executive) can read/write since migration 072 fixed RLS.

#### `/members`
Members list, invite, edit, delete. Access Matrix tab (per-member boolean overrides). 38 permission columns across 9 groups: Dashboards, Finance, Recv., Tasks, Depts, Tax Mgmt, Prod., Members, Admin. Columns added: can_view_guarantees, can_manage_guarantees, can_view_investments, can_edit_investments, can_view_dept_tax_accounts, can_manage_tax_schedule, can_manage_tax_notices, can_view_stock, can_manage_stock, can_edit_operations_targets, can_manage_meetings. finance_company_scope is a select (UTPL/IFPL/both) that only appears when can_view_finance is on. Protected members (Admin/CEO/PA) show locked (border-only) cells. Each override highlights in blue.

#### `/folderit`
- **File:** `app/folderit/page.tsx`
- **Access:** All authenticated users (PA + Admin/CEO — investment and finance data not shown here)
- **What it does:** Document Management System status dashboard, read-only.
  - **CEO/Admin view:** Per-company breakdown (UTPL, IFPL, BRNH, DIR) with inbox count + pending approvals. HR section with category file counts (Policies & SOPs) + HR inbox count.
  - **Non-admin view:** Own pending approvals only (scoped to user's email + company).
  - **Search:** Full-text search across company inboxes + HR policies + HR inbox. Company search scoped to user's company.
  - **Drill-down:** Collapsible lists showing actual file names per section. File name opens signed preview URL in new tab.
  - **Sync:** Data refreshed every 30 minutes by `/api/folderit/sync` cron.

#### `/audit-log`
System activity trail.

#### `/exceptions`
Exception management.

#### `/admin`
Source document archive, backups, restore, wipe. khuram1901@gmail.com ONLY.

#### `/monthly-operations-targets`
Monthly production/dispatch targets per plant.

#### `/department/[slug]`
- `hr` → HRDashboard
- `taxation` → TaxationDashboard (Tax Notices — enhanced with is_active, notice_status, legal_stage)
- `audit` → AuditDashboard
- `admin` → AdminDashboard
- `it` → DepartmentDashboard

---

## 8. Business Rules

### Traffic Light Thresholds

#### Operations Dashboard / Home Manager Briefing
| Metric | GREEN | AMBER | RED |
|--------|-------|-------|-----|
| Today's production vs daily target (monthly/26) | ≥90% | ≥70% | <70% |
| No production alert | — | — | No entries today AND yesterday |
| Month-to-date production vs monthly target | ±10% on track | ±20% | Outside ±20% |
| Dispatch ratio (dispatched / produced this month) | ≥85% | ≥70% | <70% |
| Breakage rate (7-day breakage / estimated weekly production) | ≤2% | ≤5% | >5% |
| Machine status | All running | Some Partially Working | Any Down |
| Ops overdue tasks | 0 overdue | 1–3 overdue | >3 overdue |

#### Finance Manager Briefing
| Signal | GREEN | AMBER | RED |
|--------|-------|-------|-----|
| Cash position freshness | Today's data exists | 1 day old | 2+ days old |
| Cash trend (3 consecutive days) | Stable or rising | Mixed | All declining |
| Net flow (7-day receipts vs payments) | Positive | — | Negative |
| Outstanding receivables (bills not Collected) | ≤5 | 5–10 | >10 |
| Overdue stages (past working_day_budget) | 0 | 1–3 | >3 |

#### Stock System
| Rule | Detail |
|------|--------|
| Production cap per PO | Produced ≤ ordered × 1.03 (3% buffer) |
| Letter cap | Sum of all authority letters for a PO ≤ ordered qty exactly |
| Dispatch hard block | Cannot dispatch more than letter's remaining balance |
| Nothing-to-report guard | If active letters exist, confirmation required before recording "nothing dispatched today" |
| Submit Dispatch disabled | Button disabled when quantities entered but no letter selected |
| Letter exhaustion warning | Remaining < 10% of authorised qty → red badge |
| PO auto-close trigger | After each dispatch_record insert, if dispatched ≥ ordered for ALL sizes → PO status = 'Closed' |

#### Tax Deadline Alert Tiers
| Tier | Meaning | Action |
|------|---------|--------|
| 1 | First warning — deadline approaching but not past | Email sent to CEO; alert stored with resolved=false |
| 2 | Overdue — deadline passed with outstanding items | Email sent to CEO; alert stored with resolved=false |

Deadlines (Pakistan fiscal year Jul–Jun):
- Quarterly schedule deadlines: 15th of the month following each quarter end
- Monthly FBR/PRA returns: 15th of the following month
- Quarterly Income Tax: 15th of the month following each quarter (Q1→Oct 15, Q2→Jan 15, Q3→Apr 15, Q4→Jul 15)
- Annual personal returns: 31 Aug (internal), 30 Sep (legal)
- Annual company returns: based on fiscal year end

#### KPI Fulfilment Bars (Stock)
| Fulfillment % | Colour |
|---------------|--------|
| ≥90% | GREEN |
| ≥60% | AMBER |
| <60% | RED |

### Auto-Task Creation Rules
1. **Recurring tasks cron** — creates tasks on schedule. `assigned_by_email` = admin email → always protected.
2. **Meeting approval** — creates tasks from action items.

### Receivables Business Rules
- Bill types: Normal, Sales Tax, Retention. Sales Tax and Retention skip IC & GRN stage.
- Stage budget: `working_day_budget` days. Bills past this are overdue.
- Editing: Ops dept only. Finance managers view-only.

### Finance Rules
- **IFPL post-dated**: `closing_after_post_dated = closing_balance + post_dated_total`
- **UTPL post-dated**: `closing_after_post_dated = closing_balance − post_dated_total`

### Meeting Rules
- "General" label → "Executive Office" everywhere — never use "General"
- Required per action item: description, owner, due date

### Task Rules
- Due date REQUIRED on every task
- Protected task — assignee can only update status + notes

### Dual-Write for Dispatch
**NEVER remove either write.** Daily entry dispatch writes to BOTH `dispatch_entries` AND `dispatch_records`.

---

## 9. Data Flows

### Finance Data Flow
Three ingestion paths — all end in `daily_cash_position` + `bank_position_snapshots`:

**Path 1 — Google Drive (primary, fully automated)**
1. Gmail receives cash sheet PDF → Google Apps Script drops to Drive `Cockpit Cash Sheets/Drop Here`
2. `/api/finance/check-drive` cron (every 10 min) parses, saves, moves to Processed

**Path 2 — Manual upload** via `/finance/upload`

**Path 3 — Gmail direct (legacy)** via `/api/finance/check-inbox`

### Production/Stock Data Flow
Daily entry → `production_entries` + `production_allocations`; dispatch → `dispatch_entries` + `dispatch_records` (dual write); PO auto-close on fulfillment.

### Tax Accounts Data Flow
1. User opens `/accounts-tax`, edits schedule steps or return filing checkboxes
2. Each save calls POST `/api/cron/tax-alerts` (fire-and-forget)
3. `computeAndStoreTaxAlerts(supabase, taxYear)` in `taxAlertEngine.ts`:
   - Reads `tax_schedule_entries` and `tax_return_filings` for the current year
   - Computes whether each deadline has been missed (tier 1 = approaching, tier 2 = overdue)
   - Upserts rows to `tax_deadline_alerts`
   - Sends email to CEO (k.saleem@unzegroup.com) for new alerts
4. Nightly cron at 00:00 UTC and 06:00 UTC runs the same engine via GET `/api/cron/tax-alerts`
5. Home page reads `tax_schedule_entries` and `tax_return_filings` for the current + previous fiscal year and renders the Tax Compliance summary card

### Meeting Minutes Data Flow
Paste/upload → Claude extraction → review & edit → approve → tasks created + notifications sent.

### Task Data Flow
All 7 task-creation paths (New Task form, PA quick-add, meeting minutes manual add, meeting AI-extraction, CSV import, recurring-task cron, cash-escalation auto-task) now go through one shared gate: `app/lib/task-creation.ts` (`createTaskCore`), reached via `POST /api/tasks/create` for every client-facing path (the recurring cron calls it in-process, server-side, no HTTP round-trip). This replaced 7 independent `supabase.from("tasks").insert()` call sites that each populated a different subset of fields — see `TASK_NOTIFICATION_AUDIT.md` for the full before/after. The gate enforces: company required (no "Group" fallback), 150-char description limit, `assigned_by` resolved from the real actor (never a hardcoded label), and always fires a notification via `app/lib/task-notifications.ts`.
Task created → gate validates + inserts → assignee notified → status updates → weekly digest.

### Alert vs. Task (14/07/2026)
Not every exception becomes a task. Rule: if the underlying data is already visible somewhere the owner checks anyway, and nothing needs to be explicitly "completed," it's an **alert** (bell icon + "Needs Your Attention" banner on the executive dashboard, live-computed, nothing persisted) — not a task. KPI escalations (production/dispatch/breakage lagging) and stuck receivables are alert-only. Cash escalation and anything requiring a specific written reply/explanation stays a task.

### Exception Escalation Flow
Cron runs → metrics vs thresholds → `/exceptions` page + manager briefings. KPI/receivable exceptions surface on the executive "Needs Your Attention" banner (Escalations / Stuck Receivables rows) rather than creating tasks — see Alert vs. Task above.

### Notification Flow
Task creation → shared gate (`createTaskCore`) → `app/lib/task-notifications.ts` → email. `/api/notifications/send` still exists as a thin wrapper around the same notify functions, for any call site not yet migrated. Push via VAPID/web-push.

---

## 10. Integration Points

### Google / Gmail
Single account: k.saleem@unzegroup.com for calendar, Gmail read, outbound notifications, backup.
`GOOGLE_REDIRECT_URI` on Vercel = `https://unze-cockpit.vercel.app/api/google/callback`

### Anthropic / Claude API
`/api/meetings/extract` — structured meeting extraction. Key from `ANTHROPIC_API_KEY`.

### Web Push Notifications
Library: `web-push`. VAPID keys. Subscriptions in `push_subscriptions`.

### Cron Jobs (all protected by `CRON_SECRET` Bearer header)
| Route | Schedule (UTC) | Purpose |
|-------|------|---------|
| `/api/finance/check-inbox` | Every 10 min | Check Gmail for cash sheet emails |
| `/api/finance/check-drive` | Every 10 min | Check Google Drive for PDF uploads |
| `/api/meetings/check-inbox` | Every 10 min | Check Gmail for meeting minutes emails |
| `/api/tasks/recurring` | 00:30 daily | Generate recurring tasks from templates |
| `/api/notifications/digest` | 00:00 daily | Send notification digest |
| `/api/reports/daily-pdf` | 03:30 daily | Generate and email daily PDF report |
| `/api/reports/weekly` | 05:00 Fridays | Generate and email weekly digest |
| `/api/backup` | 18:00 daily | Database backup |
| `/api/investments/update-prices` | 04:30 Mon–Fri | PSX opening prices (9:30am PKT) |
| `/api/investments/update-prices` | 11:00 Mon–Fri | PSX closing prices (4:00pm PKT) |
| `/api/investments/daily-summary` | 05:00 Mon–Fri | Portfolio summary email + snapshot |
| `/api/investments/fetch-dividends` | 06:00 Mon–Fri | PSX dividend auto-fetch |
| `/api/reports/monthly-po` | 06:00 1st of month | Monthly PO progress report |
| `/api/cron/tax-alerts` | 00:00 and 06:00 daily | Tax deadline alert computation |
| `/api/investments/fetch-pension-prices` | 23:00 Mon–Fri | Fetch UK pension fund NAV prices from Morningstar |
| `/api/folderit/sync` | Every 30 min | Sync Folderit inbox files + resolution invites into DB |
| `/api/notifications/ceo-digest` | 06:30 Mon–Fri (11:30am PKT) | CEO daily task/escalation/Folderit digest email |

### Supabase Storage
- Bucket: `source-documents` — uploaded PDFs
- Backups: separate bucket (managed via `/api/backup`)

---

## 11. Decisions Locked In

1. **Inline styles, not Tailwind** — intentionally inline-styled. Tailwind installed dev-only, not used at runtime.
2. **NEVER auto-run SQL migrations** — all `.sql` files in `supabase/` applied manually via Supabase SQL Editor.
3. **PA (Executive role) never sees financial data** — enforced at permission, RLS, and UI levels.
4. **Multi-company: UTPL and IFPL are separate** — never mix their `company_id` data.
5. **Management by exception** — dashboards show status and exceptions, not raw data.
6. **Dual-write for dispatch** — always write to both `dispatch_entries` AND `dispatch_records`.
7. **`isAdminTier` vs `canEditFinance`** — system features gated behind isAdminTier; data entry behind canEditFinance.
8. **"General" → "Executive Office"** — banned.
9. **Dates always DD/MM/YYYY** — via `formatDateUK()`. Never inline.
10. **British English** — all user-facing copy.
11. **`overflowX: hidden` banned on `<main>` tags** — clips kanban scroll containers.
12. **Due date required on all tasks** — enforced in NewTaskForm.
13. **Protected tasks cannot be edited by assignees** — only status + notes.
14. **`useToast()` returns `{ show, element }`** — not `{ toast, element }`.
15. **`createServiceClient()`** for all API route DB writes — bypasses RLS.
16. **`requireAuth(req)`** called first in every API route.
17. **Ops HoD (nadeem.khan@unze.co.uk)** can edit operations targets.
18. **Never use `<input type="date">`** — always use `<DateInput>` from `app/lib/DateInput.tsx`.
19. **Sidebar group order is fixed: Overview → Operations → Departments → Finance → My Workspace → Settings.** "Tasks & Meetings" and "Command Centre" groups are removed. My Workspace replaced Tasks & Meetings. Items within each group are sorted A–Z at render time. Do not change this order without a deliberate decision.
20. **Sidebar active item: NAVY background + white text + 3px blue left accent bar (COLOURS.BLUE).** Accent bar is transparent (not absent) when the sidebar is collapsed, so no layout shift. Updated 11/07/2026.
21. **Executive Dashboard number scale:** Hero (Good Stock) = 60px Inter Tight on dark NAVY card. KPI cards = 44px. Finance summary = 36px. Bank Facilities hero = 36px. Investments tiles = 28px. Mini = 32px. All −0.02em tracking and tabular-nums. SectionTitle = 22px Inter Tight/600/−0.01em.
22. **All sensitive API routes must have server-side role checks** — defence-in-depth. Pattern: `requireAuth(req)` first, then role check → 403. Bank Facilities routes are the reference implementation.
23. **Tax data is all-users visible (except PA)** — `canViewTaxAccounts()` defaults to true for all authenticated non-PA users. Manage access (`canManageTaxSchedule`) defaults to false and must be explicitly granted.
24. **Tax alert engine runs after every schedule/filing save** — POST to `/api/cron/tax-alerts` is fire-and-forget from AccountsTaxDashboard. Never block the UI on this call.
25. **Recurring tasks RLS uses `is_privileged()`** — not `is_admin_or_exec()`. Migration 072 fixed this so PA (Executive) can create and read recurring tasks.
26. **All data-returning RPCs must revoke PUBLIC EXECUTE** — migrations 092–093. Default Postgres/Supabase behaviour grants EXECUTE to PUBLIC (including anon). Every new RPC that returns real business data must `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC` after creation.
27. **`portfolio_summary` and `current_prices` views are access-revoked** — migration 094. `security_invoker = true` + REVOKE ALL from anon and authenticated. Nothing in the app uses these views; all investment queries go through `get_portfolio_summary_full()` RPC instead.
28. **Folderit is read-only from the dashboard** — the `/folderit` page and all folderit API routes only read data from the DB (synced by cron). No write operations to Folderit's API are ever made from the dashboard.
29. **CEO daily digest replaces individual task emails** — `/api/notifications/ceo-digest` sends one email per weekday (11:30am PKT). Do not re-introduce per-task email notifications to Khuram's addresses.

---

## 12. Known Issues and Open Questions

| # | Issue | Status |
|---|-------|--------|
| 19 | No server-side middleware.ts for route protection | Open — all guards are client-side only |
| 20 | In-memory rate limiter resets on Vercel cold starts | Open — needs Redis/KV for persistence |
| 50–64 | 15 low-priority upgrade items from June 2026 audit | Not started |
| — | `isAdmin` in `finance/page.tsx` vs `userIsAdmin` in `FinanceManager.tsx` — confusingly different checks | Tech debt — functional but confusing |
| — | Section spacing not standardised across all pages | 14px dominant; bulk replace deferred pending visual QA |
| — | Ops dashboard missing stale-data banner | Home and finance have it; ops dashboard deferred |

---

## 13. Recovery Instructions

If the entire project disappeared tomorrow, rebuild it as follows:

### Step 1: Restore the code
```
git clone https://github.com/khuram1901/unze-cockpit
npm install
```

### Step 2: Restore the database
1. Log in to Supabase dashboard → create a new project
2. Run all SQL migration files in order (001 through 095) via the Supabase SQL Editor. Pension tables (`pension_funds`, `pension_fund_prices`) and the original `get_pension_summary` RPC were applied directly without a numbered migration file and must also be run.
3. Restore data from the most recent backup (available in Supabase Storage or via the `/admin` page backup list)

### Step 3: Configure environment
Set all environment variables in Vercel (see Section 1).

### Step 4: Deploy
```
vercel deploy --prod
```

### Step 5: Reconnect integrations
1. Log in as khuram1901@gmail.com
2. Finance page → reconnect Gmail account via Google OAuth
3. Verify cron routes respond correctly to CRON_SECRET

### Step 6: Seed data
- `supabase/035_seed_investments.sql` — investment seed data
- `supabase/041_receivable_stages_seed.sql` — receivable stages
- Create initial members via `/members`

### Key files to understand the app
1. `BLUEPRINT.md` — this document
2. `app/lib/permissions.ts` — all access control
3. `app/lib/pageRegistry.ts` — all pages and their permission keys
4. `app/lib/SharedUI.tsx` — all design tokens and components
5. `app/lib/constants.ts` — company IDs
6. `app/lib/taxAlertEngine.ts` — tax deadline alert logic
7. `supabase/` migration files — complete database schema

---

*Blueprint created: 01/07/2026. Last full refresh: 12/07/2026. Maintained by the blueprint-keeper agent. Always keep this accurate — it is the rebuilding guide.*
