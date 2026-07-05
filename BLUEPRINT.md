# Unze Group Dashboard — Living Blueprint

> **This is the source of truth.** Read before touching any code. Last updated: 05/07/2026 (Dividend tracking, daily portfolio summary, PSX auto-fetch, DB-side aggregation overhaul).
>
> **British English throughout.** All dates in DD/MM/YYYY.

---

## 1. Project Metadata

### Identity
| Field | Value |
|-------|-------|
| Project name | business-cockpit (package.json), Unze Group Dashboard |
| Live URL | Deployed on Vercel (URL varies by environment) |
| Staging URL | Vercel preview deployments on every PR |
| Deployment | Vercel (automatic on push to main) |
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

---

## 2. Complete Folder Structure

```
app/
├── layout.tsx                        Root layout — wraps all pages in ThemeProvider + AuthWrapper
├── page.tsx                          Root redirect — sends / → /home or /login
├── globals.css                       Global CSS variables (light/dark), login animations
├── favicon.ico                       App icon
│
├── login/page.tsx                    Login page — time-based greeting, crossfade carousel, Supabase auth
├── forgot-password/page.tsx          Request password reset email via Supabase
├── reset-password/page.tsx           Confirm new password from email link
│
├── home/page.tsx                     Home dashboard — page registry cards, CEO/admin briefing,
│                                     Manager briefing (ops/finance), cron health panel (admin)
├── my-dashboard/page.tsx             Personal task summary for logged-in user
├── profile/page.tsx                  User profile — name, email, password change, notification prefs
│
├── executive/
│   ├── page.tsx                      Executive dashboard (Admin/CEO only) — cross-company KPIs
│   └── EscalationTrafficLights.tsx   Production/Dispatch/Breakage escalation count cards
│
├── pa/page.tsx                       PA Dashboard — tasks, notes, calendar events, delegations
│
├── dashboard/
│   ├── page.tsx                      Operations Dashboard shell — loads DashboardView
│   ├── DashboardView.tsx             Full ops dashboard: plant KPIs, charts, stock by PO,
│                                     tasks, machine issues, breakage pareto
│   └── MonthlyTargets.tsx            Monthly targets edit form (inline modal)
│
├── finance/
│   ├── page.tsx                      Finance index — company picker, dept budgets, bulk upload
│   ├── FinanceManager.tsx            Per-company finance dashboard: daily position, opening balance,
│   │                                 cash plan, monthly budgets, charts. "Reconnect Google" button
│   │                                 returns user to company page after OAuth
│   ├── [company]/page.tsx            Dynamic route — passes slug to FinanceManager
│   └── upload/page.tsx               Manual PDF upload — drag-and-drop cash flow + bank position
│                                     PDFs, auto-detects company, shows per-file save status
│
├── receivables/page.tsx              Receivables kanban — stage pipeline for MEPCO/customer bills
│
├── investments/page.tsx              PSX portfolio tracker — holdings, current prices, P&L
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
│   ├── AuditDashboard.tsx            Audit dept — audit plan items, findings
│   ├── HRDashboard.tsx               HR dept — recruitment, evaluations, strategy goals
│   ├── TaxationDashboard.tsx         Taxation dept — legal notices, tax deadlines
│   └── AdminDashboard.tsx            Admin dept — categories, spend tracking
│
├── exceptions/page.tsx               Exception management — surfaced alerts and rule violations
├── audit-log/page.tsx                System audit log — all user actions (timestamped)
├── admin/page.tsx                    Data & Backups — source document archive, backup/restore
│                                     (khuram1901@gmail.com ONLY)
│
├── monthly-operations-targets/page.tsx  Monthly production/dispatch targets per plant
│
└── lib/
    ├── supabase.ts                   Supabase browser client + loadMyPermissions helper
    ├── supabase-server.ts            createServiceClient() — server-side (bypasses RLS)
    ├── api-auth.ts                   requireAuth(req) — validates Bearer token in API routes
    ├── permissions.ts                Central permission functions — SINGLE SOURCE OF TRUTH
    ├── pageRegistry.ts               PAGE_REGISTRY — maps permKeys to home dashboard cards
    ├── useRouteGuard.ts              useRequireCapability() + useRequireDepartment() hooks
    ├── useUserCtx.ts                 useUserCtx() hook — loads user role/dept/overrides
    ├── AuthWrapper.tsx               Wraps app — handles auth state, notification bell, sidebar
    ├── SidebarLayout.tsx             Sidebar nav + mobile header — visibility via PERM_FUNC map.
│   │                                 SIDEBAR_GROUPS order: Finance → Departments → Operations →
│   │                                 Tasks & Meetings → Settings. "Command Centre" group removed
│   │                                 (contained only PA Dashboard, never shown to Admin/CEO).
│   │                                 Items within each group are sorted A–Z case-insensitively at
│   │                                 render time via .sort((a,b) => a.title.trim().toLowerCase()
│   │                                 .localeCompare(b.title.trim().toLowerCase())).
    ├── ThemeProvider.tsx             Dark/light mode context
    ├── SharedUI.tsx                  Design tokens (COLOURS, RADII, SHADOWS) + shared components
    ├── constants.ts                  COMPANIES array — UTPL and IFPL IDs/slugs
    ├── dateUtils.ts                  formatDateUK, formatDateTimeUK, todayISO, etc.
    ├── DateInput.tsx                 Custom DD/MM/YYYY date input — replaces all <input type="date">
    │                                 Shows DD/MM/YYYY, auto-inserts slashes, validates on blur,
    │                                 calls onChange with YYYY-MM-DD. Fixes Safari MM/DD/YYYY issue.
    ├── department-config.ts          Department slug → name mapping
    ├── audit-log.ts                  logAuditEvent() helper
    ├── send-email.ts                 Email sending via Gmail API
    ├── google-client.ts              Google OAuth2 client setup
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
        └── reconcile.ts              Reconcile parsed vs existing position data

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
├── finance/
│   ├── bulk-upload/route.ts          POST — upload multiple PDF cash flow files (admin only)
│   ├── upload-pdfs/route.ts          POST — manual drag-and-drop PDF upload (cash flow + bank position pairs)
│   ├── check-drive/route.ts          GET — cron every 10min; reads PDFs from Google Drive Drop Here folder,
│   │                                 parses them, saves to daily_cash_position + bank_position_snapshots,
│   │                                 moves processed files to Processed folder
│   ├── setup-drive-folder/route.ts   GET — one-time setup; creates Cockpit Cash Sheets/Drop Here/Processed
│   │                                 folders in Google Drive, saves folder IDs to app_settings table
│   ├── setup-gmail-filter/route.ts   GET — creates cockpit-cash Gmail label + filter (CRON_SECRET gated)
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
├── google/
│   ├── auth/route.ts                 GET — initiate Google OAuth2 flow; accepts ?returnTo= param so
│   │                                 callback redirects back to originating page (finance/calendar)
│   ├── callback/route.ts             GET — OAuth2 callback; reads state param for returnTo redirect
│   ├── auth-notifications/route.ts   GET — initiate OAuth2 flow (Gmail notifications)
│   ├── callback-notifications/route.ts GET — OAuth2 callback (Gmail notifications)
│   └── status/route.ts              GET — check connected Google accounts
├── health/route.ts                   GET — basic health check endpoint
├── investments/
│   └── update-prices/route.ts        POST — refresh PSX stock prices (admin only)
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
│   ├── password-changed/route.ts     POST — notify admin of password change
│   ├── push-subscribe/route.ts       POST — register push subscription (server validates email)
│   ├── push/route.ts                 POST — send push notification to specific user
│   └── send/route.ts                 POST — send email notification
├── reports/
│   ├── daily-pdf/route.ts            POST — generate and send daily PDF report (cron)
│   └── weekly/route.ts               POST — generate and send weekly email digest (cron)
├── stock/
│   ├── authority-letters/route.ts    GET/POST — list/create authority letters; GET with letterNumber lookup
│   ├── contractors/route.ts          GET/POST — list/create contractors
│   ├── dispatch-records/route.ts     GET/POST — list/create dispatch records
│   ├── production-allocations/route.ts GET/POST — list/replace production allocations
│   ├── purchase-orders/route.ts      GET/POST/PATCH — manage purchase orders
│   └── summary/route.ts              GET — full stock tree per plant (POs → letters → balances)
└── tasks/
    └── recurring/route.ts            POST — generate recurring tasks from templates (cron)
```

---

## 3. Design System

### Colours (SharedUI.tsx — COLOURS constant)
| Token | Hex | Semantic use |
|-------|-----|-------------|
| `NAVY` | `#1e293b` | Primary text, primary button background, borders accent |
| `SLATE` | `#64748b` | Secondary text, disabled states, "Settings" group |
| `BORDER` | `#e2e8f0` | Card borders, table dividers, input borders |
| `LIGHT` | `#f1f5f9` | Light background, hover states |
| `BG` | `#f8fafc` | Page background |
| `GREEN` | `#16a34a` | Success, on-track status, Finance group colour |
| `AMBER` | `#d97706` | Warning, at-risk status, Tasks & Meetings group |
| `RED` | `#dc2626` | Error, critical status, danger actions |
| `BLUE` | `#2563eb` | Information, Operations group, "Submitted" status |
| `TEAL` | `#059669` | Alternative green accent (rarely used) |
| `PURPLE` | `#7c3aed` | Departments group colour |

#### Group Colours (pageRegistry.ts — GROUP_COLOURS)
| Group | Colour |
|-------|--------|
| Command Centre | `#0f172a` (near-black) |
| Finance | `#16a34a` (green) |
| Operations | `#2563eb` (blue) |
| Tasks & Meetings | `#d97706` (amber) |
| Departments | `#7c3aed` (purple) |
| Settings | `#64748b` (slate) |

### Fonts
- System font stack (no custom font imported)
- Page body: ~16–17px
- Table header: 15px, weight 700
- Table cell: 16px, weight 400 (bold variant weight 700)
- Section title: 17px, weight 700
- Card label: 12px, weight 400
- Card value: 17px, weight 800
- Primary button: 17px, weight 700

### Border Radius (RADII constant)
| Token | Value | Usage |
|-------|-------|-------|
| `CARD` | 12px | Card containers |
| `BUTTON` | 8px | Buttons |
| `BADGE` | 6px | Status badges |
| `PILL` | 16px | Navigation pills, tag pills |

### Shadows (SHADOWS constant)
| Token | Value | Usage |
|-------|-------|-------|
| `CARD` | `0 1px 3px rgba(15,23,42,0.06)` | Default card shadow |
| `ELEVATED` | `0 4px 12px rgba(15,23,42,0.08)` | Elevated panels |
| `DROPDOWN` | `0 8px 30px rgba(15,23,42,0.12)` | Dropdowns, sidebar |
| `MODAL` | `0 2px 6px rgba(0,0,0,0.15)` | Modal overlays |
| `HOVER` | `0 2px 8px rgba(0,0,0,0.1)` | Hover state lift |

### Spacing
- Page padding: `14px 18px` (mobile: `12px 14px`)
- Card padding: `6px 8px` (compact)
- Gap between cards: `8px`
- Gap between sections: `14px`
- **NEVER use `overflowX: hidden` on `<main>` tags** — clips nested scroll containers

### Shared Components in lib/SharedUI.tsx

| Component / Export | Props | Purpose |
|-------------------|-------|---------|
| `COLOURS` | — | Colour token object |
| `RADII` | — | Border radius constants |
| `SHADOWS` | — | Shadow constants |
| `displayRole(role, email?)` | string, string? | Returns "CEO" for k.saleem email, else role |
| `statusColor(status)` | string\|null | Maps status string to colour hex |
| `priorityColor(priority)` | string\|null | Maps priority to colour hex |
| `SectionTitle` | `{ title, style? }` | h2 with left border accent at 17px/700 |
| `PageHeader` | `{ hideHome? }` | "← Home" back link pill |
| `StatusBadge` | `{ status }` | Coloured pill badge for status values |
| `PriorityBadge` | `{ priority }` | Coloured pill badge for priority values |
| `CountCard` | `{ label, value, color, sub? }` | Compact KPI card with top border in colour |
| `TrafficLight` | `{ status: RAGStatus, label, detail? }` | Green/Amber/Red dot with label |
| `FreshnessBadge` | `{ date, label? }` | Data age indicator: green 0–1d, amber 2–3d, red 4+d |
| `WARNING_BANNER_STYLE` | — | Style object for red warning banner |
| `tableHeaderStyle` | — | Style for `<th>` elements |
| `tableCellStyle` | — | Style for `<td>` elements |
| `tableCellBoldStyle` | — | Bold variant of tableCellStyle |
| `labelStyle` | — | Form label style |
| `inputStyle` | — | Form input style (full-width, border, 17px) |
| `primaryButtonStyle` | — | Navy primary button style |
| `Toast` | `{ message, type?, onClose }` | Fixed-position toast notification |
| `useToast()` | — | Returns `{ show(msg, type), element }` |
| `ConfirmDialog` | `{ message, onConfirm, onCancel, confirmLabel?, danger? }` | Modal confirm dialog |
| `useConfirm()` | — | Returns `{ confirm(msg, danger?), element }` |
| `ErrorBanner` | `{ message, onRetry? }` | Red error banner with optional retry |
| `SkeletonCard` | `{ width?, height? }` | Shimmer loading placeholder |
| `SkeletonRows` | `{ count?, height? }` | Multiple skeleton rows for table loading |

### Date Format Rules
- **All displayed dates: DD/MM/YYYY** via `formatDateUK()` from `lib/dateUtils.ts`
- **Date-times:** `formatDateTimeUK()` — DD/MM/YYYY HH:MM
- **Month only:** `formatMonthUK()` — MM/YYYY
- **Database storage:** ISO format (YYYY-MM-DD) — never localise on input
- **NEVER** inline date formatting — always import from `lib/dateUtils.ts`

### Status Colour Map
| Status | Colour |
|--------|--------|
| Completed, Closed, Approved, Resolved, Collected | GREEN `#16a34a` |
| In Progress, Pending, Partially Working | AMBER `#d97706` |
| Submitted | BLUE `#2563eb` |
| Waiting Reply, Open, Down, Rejected | RED `#dc2626` |
| Cancelled | SLATE `#64748b` |

---

## 4. Complete Database Schema

> Source of truth: `supabase/` migration files 001–056. All migrations are applied **manually** via the Supabase SQL Editor — never auto-run.

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
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| company_id | uuid FK → companies | |
| position_date | date | UNIQUE with company_id |
| cash_at_office | numeric | |
| js_bank_unze_trading | numeric | |
| askari_bank_saving | numeric | |
| allied_bank_unze_trading | numeric | |
| dib_bank | numeric | |
| silk_bank_saving | numeric | |
| mcb_unze_trading | numeric | |
| askari_saving_1489 | numeric | |
| askari_saving_unze_trading | numeric | |
| hbl_pf_unze_trading | numeric | |
| meezan_bank_unze_trading | numeric | |
| hbl_unze_trading | numeric | |
| hbl_h_unze_trading | numeric | |
| faysal_bank_unze_trading | numeric | |
| total_available_balance | numeric | |
| post_dated_cheques_total | numeric | |
| post_dated_currency | text | DEFAULT 'PKR' |
| raw_pdf_filename | text | |
| uploaded_by | text | |
| reconciled | boolean | |
| reconcile_notes | text | |
| created_at | timestamptz | |

#### `department_budgets`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| company_id | uuid FK → companies NOT NULL | Added NOT NULL in migration 014 |
| department_name | text | |
| budget_month | text | 'YYYY-MM' |
| budgeted_amount | numeric | |
| actual_amount | numeric | |
| notes | text | |
| created_at | timestamptz | |

#### `opening_balances` / `cash_opening_balance`
Two related tables — see also `cash_opening_balance` above. `opening_balances` is the older table; `cash_opening_balance` is the newer company-scoped one. See `opening-balances/` page.

---

### Receivables tables

#### `receivable_stages`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | text | Stage label |
| order_index | int | Sort order for kanban |
| working_day_budget | int | Max working days to spend at this stage |
| created_at | timestamptz | |

**Seeded:** 9 stages (re-seeded in migration 041). PA cannot view.

#### `receivables`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| plant_id | uuid FK → plants | Not company-scoped — linked to plant |
| bill_number | text | |
| bill_type | text | 'Normal', 'Sales Tax', 'Retention' (added in 041) |
| amount | numeric | |
| issue_date | date | |
| stage_id | uuid FK → receivable_stages | Current pipeline stage |
| status | text | 'Active', 'Collected' |
| collected_date | date | |
| notes | text | |
| created_at | timestamptz | |

**RLS:** Admin/CEO + Finance managers + Ops managers.
**Pages:** `receivables/page.tsx` reads and writes.

---

### Operations / Production tables

#### `plants`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | text | Plant name (e.g. "Plant 1") |
| type | text | Plant type |
| active | boolean | |
| created_at | timestamptz | |

#### `member_plants`
Junction: which members are assigned to which plants.
| Column | Type |
|--------|------|
| member_id | uuid FK → members |
| plant_id | uuid FK → plants |

#### `production_entries`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| plant_id | uuid FK → plants | |
| entry_date | date | |
| produced_31 | numeric | Pipes size 31 |
| produced_36 | numeric | Pipes size 36 |
| produced_45 | numeric | Pipes size 45 |
| produced_meter | numeric | Meters produced |
| entered_by | text | |
| created_at | timestamptz | |

**Constraint (migration 044):** UNIQUE(plant_id, entry_date) — one entry per plant per day.

#### `dispatch_entries`
Legacy dispatch table — keeps ops dashboard working.
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| plant_id | uuid FK → plants | |
| entry_date | date | |
| dispatched_31 | numeric | |
| dispatched_36 | numeric | |
| dispatched_45 | numeric | |
| dispatched_meter | numeric | |
| entered_by | text | |
| created_at | timestamptz | |

**Constraint:** UNIQUE(plant_id, entry_date).

#### `breakage_entries`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| plant_id | uuid FK → plants | |
| entry_date | date | |
| broken_31 | numeric | |
| broken_36 | numeric | |
| broken_45 | numeric | |
| entered_by | text | |
| created_at | timestamptz | |

#### `scrap_processed_entries`
Scrap/recycled material entries.
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| plant_id | uuid FK → plants | |
| entry_date | date | |
| scrap_processed | numeric | |
| entered_by | text | |
| created_at | timestamptz | |

#### `broken_opening_balances`
Opening broken stock balances per plant.
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| plant_id | uuid FK → plants | |
| balance_31 | numeric | |
| balance_36 | numeric | |
| balance_45 | numeric | |
| created_at | timestamptz | |

#### `machine_issues`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| plant_name | text | |
| machine_name | text | |
| issue_status | text | 'Down', 'Partially Working' |
| issue_description | text | |
| action_taken | text | |
| expected_resolution | date | |
| created_at | timestamptz | |

#### `monthly_production_targets`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| plant_id | uuid FK → plants | |
| plant_name | text | |
| target_month | text | 'YYYY-MM' |
| target_31 | numeric | |
| target_36 | numeric | |
| target_45 | numeric | |
| target_meter | numeric | |
| created_at | timestamptz | |

#### `monthly_dispatch_targets`
Same structure as monthly_production_targets but for dispatch.

---

### Stock system tables (migration 048, applied 01/07/2026)

Hierarchy: Plant → PurchaseOrder → Contractor → AuthorityLetter → DispatchRecord

#### `purchase_orders`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| plant_id | uuid FK → plants | ON DELETE RESTRICT |
| plant_name | text | Denormalised for display |
| customer_name | text | e.g. 'MEPCO', 'FESCO' |
| po_number | text | UNIQUE with plant_id |
| po_label | text | e.g. 'Old PO', '1st Year PO with 15% Repeat' |
| ordered_31 | numeric | |
| ordered_36 | numeric | |
| ordered_45 | numeric | |
| ordered_meter | numeric | |
| variance_pct | numeric | DEFAULT 3 — allowed overproduction buffer % |
| status | text | 'Active' or 'Closed' CHECK constraint |
| is_system_unallocated | boolean | Auto-created per plant, cannot be deleted/closed |
| start_date | date | |
| notes | text | |
| created_by | text | |
| created_at / updated_at | timestamptz | |
| opening_produced_31/36/45/meter | numeric | Backfill for pre-go-live production history |

**Constraint:** UNIQUE(plant_id, po_number).
**Index:** po_plant_idx on (plant_id, status).
**RLS:** Read = authenticated; Write = admin/exec OR Manager role.

#### `production_allocations`
Links a `production_entries` row to one PO.
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| production_entry_id | uuid FK → production_entries | ON DELETE CASCADE |
| po_id | uuid FK → purchase_orders | ON DELETE RESTRICT |
| qty_31 | numeric | |
| qty_36 | numeric | |
| qty_45 | numeric | |
| qty_meter | numeric | |
| created_at | timestamptz | |

**Constraint:** UNIQUE(production_entry_id, po_id).
**RLS:** Any authenticated user can write (plant member allocations).

#### `contractors`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | text NOT NULL | |
| cnic_or_id | text | |
| contact_phone | text | |
| contact_address | text | |
| notes | text | |
| created_by | text | |
| created_at | timestamptz | |

**Index:** contractors_name_idx on lower(name).
**RLS:** Read = authenticated; Write = admin/exec OR Manager.

#### `po_contractors`
Junction: PO ↔ Contractor (many-to-many).
| Column | Type |
|--------|------|
| id | uuid PK |
| po_id | uuid FK → purchase_orders ON DELETE CASCADE |
| contractor_id | uuid FK → contractors ON DELETE RESTRICT |
| created_at | timestamptz |

**Constraint:** UNIQUE(po_id, contractor_id).

#### `authority_letters`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| po_id | uuid FK → purchase_orders | ON DELETE RESTRICT |
| contractor_id | uuid FK → contractors | ON DELETE RESTRICT |
| letter_number | text NOT NULL | |
| issue_date | date NOT NULL | |
| expiry_date | date | Added in migration 049 |
| issued_by | text NOT NULL | MEPCO-side person |
| qty_31/36/45/meter | numeric | Authorised quantities |
| opening_dispatched_31/36/45/meter | numeric | Backfill for pre-go-live pickups |
| notes | text | |
| created_by | text | |
| created_at | timestamptz | |

**Constraint:** UNIQUE(po_id, letter_number).
**Indexes:** auth_letters_po_idx, auth_letters_contractor_idx.
**RLS:** Read = authenticated; Write = admin/exec OR Manager.

#### `dispatch_records`
Individual pickups against an authority letter (stock system — separate from `dispatch_entries`).
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| authority_letter_id | uuid FK → authority_letters | ON DELETE RESTRICT |
| dispatch_date | date | DEFAULT current_date |
| qty_31/36/45/meter | numeric | |
| released_by | text NOT NULL | Plant staff who released stock |
| vehicle_number | text | |
| notes | text | |
| created_by | text | |
| created_at | timestamptz | |

**Indexes:** dispatch_records_letter_idx, dispatch_records_date_idx.
**RLS:** Any authenticated user can write.

---

### Tasks and meetings tables

#### `tasks`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| task_type | text | |
| description | text NOT NULL | |
| project | text | Department/project label |
| priority | text | 'Urgent', 'High', 'Medium', 'Normal', 'Low' |
| due_date | date | **Required** — all tasks must have a due date |
| assigned_date | date | |
| assigned_to | text | Assignee name |
| assigned_to_email | text | Assignee email |
| assigned_to_department | text | |
| assigned_by | text | Creator name |
| assigned_by_email | text | Creator email — added migration 042 |
| status | text | 'Not Started', 'In Progress', 'Waiting Reply', 'Submitted', 'Completed', 'Cancelled' |
| completion_notes | text | |
| meeting_id | uuid FK → meetings | If created from meeting |
| time_spent_minutes | int | DEFAULT 0, added migration 018 |
| created_at | timestamptz | |

**RLS:** See migration 027 — Admin/PA/CEO see all; members see own assigned/created tasks.

#### `recurring_tasks`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| description | text NOT NULL | |
| assigned_to | text | |
| assigned_to_email | text | |
| assigned_to_department | text | |
| assigned_by | text | |
| priority | text | DEFAULT 'Normal' |
| project | text | |
| frequency | text | 'weekly', 'monthly', 'quarterly' |
| day_of_week | int | 0=Sun … 6=Sat |
| day_of_month | int | 1–31 |
| due_days_after | int | DEFAULT 3 |
| active | boolean | |
| last_created_at | timestamptz | |
| created_at | timestamptz | |

**RLS:** Admin/Exec only read and write.

#### `meetings`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| meeting_date | date NOT NULL | |
| title | text NOT NULL | |
| company | text | Company name |
| department | text | 'Executive Office' for cross-dept |
| executive_summary | text | AI-generated |
| decisions | jsonb | Array of decision strings |
| risks | jsonb | Array of risk strings |
| opportunities | jsonb | Array of opportunity strings |
| attendees | jsonb | Array of attendee objects |
| raw_transcript | text | Original input |
| created_by | text | |
| created_at | timestamptz | |

#### `meeting_attendees`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| meeting_id | uuid FK → meetings | ON DELETE CASCADE |
| member_email | text | |
| member_name | text | |
| viewed_at | timestamptz | When they read the minutes |

#### `meeting_tasks`
| Column | Type |
|--------|------|
| meeting_id | uuid FK → meetings |
| task_id | uuid FK → tasks |
| PRIMARY KEY | (meeting_id, task_id) |

#### `pending_minutes`
Gmail-ingested raw minutes awaiting admin review.
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| gmail_message_id | text | |
| subject | text | |
| from_email | text | |
| raw_body | text | |
| created_at | timestamptz | |

**RLS:** Admin/Executive only (migration 038).

---

### Notification tables

#### `notification_log`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| recipient_email | text NOT NULL | |
| recipient_name | text | |
| channel | text NOT NULL | 'email', 'whatsapp' |
| subject | text | |
| body_preview | text | |
| trigger_type | text NOT NULL | |
| trigger_record_id | text | |
| status | text | DEFAULT 'sent' |
| created_at | timestamptz | |

#### `push_subscriptions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| email | text NOT NULL | |
| endpoint | text NOT NULL | |
| p256dh | text | |
| auth | text | |
| created_at | timestamptz | |

**RLS:** Own email only (migration 038).

---

### Google OAuth table

#### `google_oauth_tokens`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| email | text | Authorised Google account email |
| access_token | text | Encrypted (migration 014) |
| refresh_token | text | Encrypted |
| expires_at | timestamptz | |
| scope | text | |
| created_at | timestamptz | |

**RLS:** Admin-tier only.

---

### Investment tables

#### `holdings`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| ticker | text NOT NULL | PSX ticker |
| company_name | text | |
| quantity | numeric NOT NULL | |
| buy_price | numeric NOT NULL | Per-share cost |
| buy_date | date | |
| target_price | numeric | Sell target |
| notes | text | |
| created_at | timestamptz | |

**RLS:** CEO/Admin only for all operations (updated in migration 038).

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
| ticker | text NOT NULL | PSX ticker |
| dividend_per_share | numeric(12,4) NOT NULL | Rs per share |
| ex_dividend_date | date NOT NULL | |
| payment_date | date | |
| announced_date | date | |
| status | text | 'upcoming', 'paid', 'cancelled' |
| source | text | 'manual', 'auto-psx', 'auto-company-site' |
| confirmed | boolean NOT NULL DEFAULT false | true = manual/verified; false = auto-fetched unverified |
| notes | text | Raw PSX label stored here for traceability |
| entered_by | text | Email of who added/triggered entry |
| entered_at | timestamptz | |

**Constraint:** UNIQUE(ticker, ex_dividend_date). Manual (confirmed=true) entries are never overwritten by auto-fetch. RLS: authenticated read; Admin/CEO write via service client.

#### `portfolio_snapshots` — migration 066
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| snapshot_date | date NOT NULL | |
| ticker | text NOT NULL | |
| total_qty | numeric | |
| total_cost | numeric | |
| current_price | numeric | |
| current_value | numeric | |
| gain_loss | numeric | |
| gain_loss_pct | numeric | |
| created_at | timestamptz | |

**Constraint:** UNIQUE(snapshot_date, ticker). Written by the daily-summary cron each weekday. Used by `get_portfolio_summary_full` to compute day-on-day change without re-fetching yesterday's prices.

#### Views
- `current_prices` — latest price per ticker (DISTINCT ON). Legacy view, still exists in DB.
- `portfolio_summary` — joins holdings with current_prices for P&L view. Legacy view.

**Important:** Neither view is used by the live app. All pages use `get_portfolio_summary_full` RPC (migration 067) which handles today and historical dates and returns everything in one round-trip. `get_portfolio_summary_as_of` (migration 054) still exists in the DB but is no longer called by any page.

---

### Postgres RPC Functions (performance layer)

These functions run entirely in Postgres and return pre-aggregated results. **Never replaced by raw table fetches** — they are the correct way to load data on the pages below.

#### `get_portfolio_summary_as_of(as_of date)` — migration 054
Returns one row per ticker with: ticker, company_name, total_qty, total_cost, avg_cost, current_price, price_date, current_value, gain_loss, gain_loss_pct.
- Still exists in DB. **No longer called by any page** — superseded by `get_portfolio_summary_full` (067).

#### `get_portfolio_summary_full(p_as_of date, p_alert_pct numeric, p_div_days int)` — migration 067
Returns a single JSONB object with everything needed for the investments page and executive dashboard — no JS aggregation required:
- `totals`: total_cost, total_value, gain_loss, gain_loss_pct, stock_count, price_date, prev_value (from yesterday's snapshots), day_change, day_change_pct, dividend_count (confirmed divs due within p_div_days)
- `stocks`: array of per-ticker rows (ticker, company_name, total_qty, total_cost, avg_cost, target_price, current_price, price_date, current_value, gain_loss, gain_loss_pct)
- `losers`: array of stocks where gain_loss_pct ≤ p_alert_pct, ordered worst first
- **Used by:** `app/investments/page.tsx` (p_alert_pct=-3, p_div_days=7), `app/home/page.tsx` (same params).

#### `get_portfolio_daily_summary(p_as_of, p_prev_date, p_alert_pct, p_div_days)` — migration 066
Returns a full JSONB summary used exclusively by the daily-summary cron:
- `totals`, `stocks`, `alerts`, `best`, `worst`, `dividends` (confirmed + unconfirmed arrays)
- **Used by:** `app/api/investments/daily-summary/route.ts` only. Not called from any page.

#### `get_upcoming_dividends(p_days_ahead int)` — migration 065
Returns confirmed + unconfirmed dividends joined with holdings (total_qty, estimated_payout, days_to_ex).
- **Used by:** `app/investments/page.tsx` (via `/api/investments/dividends?mode=upcoming`), `app/pa/page.tsx` (direct RPC, confirmed only).

#### `get_plant_kpis(as_of_date date, month_start date, month_end date)` — migration 055
Returns one row per active plant with opening balances, cumulative totals since cutoff, on-date totals, MTD totals, and entered_on_date boolean.
- Replaces 7 raw table fetches: opening_balances, broken_opening_balances, production_entries (90d), dispatch_entries (90d), breakage_entries (90d), scrap_processed_entries (90d).
- **Used by:** `app/home/page.tsx`, `app/executive/page.tsx`, `app/dashboard/DashboardView.tsx`.
- Monthly production/dispatch/breakage arrays are still fetched separately for the daily ops chart (needs per-day breakdown) and quarterly escalation checks (needs per-quarter cumulative sums).

#### `get_receivable_rag_by_customer()` — migration 056
Returns one row per customer with green_amount, amber_amount, red_amount, total_amount, red_count.
- RAG status computed in Postgres using working-day arithmetic and stage budgets.
- **Used by:** `app/home/page.tsx` (receivables section + Finance Manager briefing).

#### `get_receivable_aging_totals()` — migration 056
Returns 4 rows (buckets: 0-30, 31-60, 61-90, 90+) with total PKR amount per bucket.
- **Used by:** `app/home/page.tsx` (receivables aging bar).

#### `get_receivable_aging_by_customer()` — migration 056
Returns one row per customer with b0_30, b31_60, b61_90, b90_plus, total columns.
- **Used by:** `app/home/page.tsx` (receivables aging by customer chart).

**Security:** All RPCs use `security definer` + `set search_path = public` — they bypass RLS intentionally and are accessible to `authenticated` role only. Raw `receivables` table rows are NOT readable by the browser client directly (RLS blocks anon/authenticated reads) — the RPCs are the only correct read path.

---

### Department tables

#### `audit_plan_items`
| Column | Type |
|--------|------|
| id | uuid PK |
| company_id | uuid FK → companies NOT NULL |
| audit_area | text NOT NULL |
| audit_type | text |
| scope | text |
| planned_date | date |
| status | text DEFAULT 'Planned' |
| findings_count | int DEFAULT 0 |
| assigned_to | text |
| notes | text |
| created_at | timestamptz |

#### `audit_findings`
Linked to `audit_plan_items`. Fields: severity, risk_impact, description, owner, due_date, evidence_url, status.

#### `recruitment_positions`
HR table. Fields: position_title, department, status, date_opened, date_filled, time_to_hire_days.

#### `performance_evaluations`
HR table. Fields: employee_name, department, evaluation_period, rating, status, completed_date.

#### `hr_strategy_goals`
HR table. Fields: goal_title, target_date, progress_pct, status.

#### `legal_notices`
Shared Legal/Tax table. Key fields: notice_type ('legal'/'tax'), title, received_date, consultant_name, hearing_deadline, financial_exposure, resolution_status.

#### `admin_categories` / `admin_spend`
Admin department budget tracking. Categories define monthly budgets; spend records actual expenditure by month.

---

### Other tables

#### `leave_records`
| Column | Type |
|--------|------|
| id | uuid PK |
| member_email | text NOT NULL |
| member_name | text |
| leave_type | text DEFAULT 'Annual' |
| start_date | date NOT NULL |
| end_date | date NOT NULL |
| days | int DEFAULT 1 |
| reason | text |
| status | text DEFAULT 'Pending' |
| approved_by | text |
| created_at | timestamptz |

#### `audit_log`
| Column | Type |
|--------|------|
| id | uuid PK |
| user_email | text NOT NULL |
| user_name | text |
| action | text NOT NULL |
| table_name | text NOT NULL |
| record_id | text |
| details | text |
| created_at | timestamptz |

Indexes on created_at DESC, user_email, table_name.

#### `app_settings`
Key/value store for application configuration (migration 052).
| Column | Type | Notes |
|--------|------|-------|
| key | text PK | e.g. 'drive_inbox_folder_id', 'drive_processed_folder_id' |
| value | text NOT NULL | |
| updated_at | timestamptz | DEFAULT now() |

**RLS:** Service role only (no direct client access). Written by setup-drive-folder route.

---

#### `document_archive`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| doc_type | text NOT NULL | 'cash_flow', 'bank_position' |
| company_id | uuid FK → companies | |
| position_date | date | |
| storage_path | text NOT NULL | Path in source-documents bucket |
| original_filename | text NOT NULL | |
| source | text | 'manual' or 'gmail-auto' |
| uploaded_by | text | |
| created_at | timestamptz | |

**RLS:** Admin-tier only (matches holdings — strictest policy).

#### `department_owners`
Maps departments to responsible members. Referenced from ops dashboard.

#### `meeting_requests`
Calendar/meeting request tracking (referenced in code).

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
| `canViewInvestments` | CEO + Admin + PA (view-only for PA) | can_view_investments |
| `canEditInvestments` | CEO + Admin by email only | can_edit_investments |
| `canViewPADashboard` | PA + Admin/CEO | can_view_pa_dashboard |
| `canViewDepartment(dept)` | Admin/CEO + Manager of that dept (NOT PA) | can_view_dept_* |
| `canEditOperationsTargets` | Privileged + Ops HoD (nadeem.khan@unze.co.uk) | — |

### Finance Company Scoping
`financeCompanies(ctx)` returns 'UTPL', 'IFPL', 'both', or 'none':
- Admin/CEO → 'both'
- Finance Manager with company tagged 'Unze Trading*' → 'UTPL'
- Finance Manager with company tagged 'Imperial*' → 'IFPL'
- Finance Manager with no company → 'both'
- Override `finance_company_scope` in member_permissions → takes precedence

### Task Ownership Rules
- `assigned_by_email` column tracks creator
- **Protected tasks**: created by Admin/CEO/PA email — assignees can only update status and add notes
- **Self-assigned tasks**: full control — edit, delete, change due date
- `isTaskProtected(email)` — true if creator is Admin/CEO/PA
- `canEditTask(ctx, email)` — Admin/PA can always edit; others cannot if task is protected
- `canDeleteTask(ctx, email)` — same logic as canEditTask

### Member Administration Rules
- `assignableRoles(ctx)`: Admin-tier → all roles; Executive → Manager/Member only; others → none
- `canEditMember(actor, target)`: LOCKED_EMAILS can only be edited by another Admin-tier
- `canDeleteMember(actor, target)`: PROTECTED_EMAILS (Admin + CEO) can never be deleted
- `canChangePasswordFor(actor, target)`: Admin-tier → anyone; Executive → self + Members only

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

The Bank Facilities page has both UI-level permission gates AND server-side role checks enforced in the API routes. Any authenticated user outside the allowed roles receives `403 Forbidden` immediately, regardless of what the UI shows.

| Route | Method | Allowed roles |
|-------|--------|---------------|
| `/api/finance/guarantees` | GET | Admin, CEO, Finance Manager, Ops Manager |
| `/api/finance/guarantees` | POST / PATCH / DELETE | Admin, CEO, Finance Manager only |
| `/api/finance/guarantee-facilities` | All methods | Admin, CEO, Finance Manager only |

**Pattern:** After `requireAuth(req)`, each route calls a role check helper and returns `NextResponse.json({ error: "Forbidden" }, { status: 403 })` for any role not in the allowed list. This is defence-in-depth on top of the existing UI gates.

---

## 6. Every Page and Workflow

### Public pages (no authentication)

#### `/login`
- **File:** `app/login/page.tsx`
- **Access:** Public
- **What it does:** Supabase email + password authentication. Shows time-based greeting (morning/afternoon/evening). Right panel has an image carousel with crossfade transitions. Mobile shows a navy brand strip with rotating slide info. On success, redirects to `/home` (PA redirects to `/pa`).

#### `/forgot-password`
- **File:** `app/forgot-password/page.tsx`
- **Access:** Public
- Sends Supabase password reset email.

#### `/reset-password`
- **File:** `app/reset-password/page.tsx`
- **Access:** Public (requires valid reset token)
- Sets new password from email link.

---

### Authenticated pages

#### `/home`
- **File:** `app/home/page.tsx`
- **Access:** All authenticated users (PA auto-redirects to `/pa`)
- **What it does:**
  - Shows PAGE_REGISTRY cards grouped by section (only cards the user has permission for)
  - CEO/Admin: briefing strip (cash total, production %, stuck bills, sparklines), quick task actions
  - **Investments card**: shows total cost, current value, gain/loss, return %. If any confirmed dividends are due within 7 days, shows an amber "X dividends due this week" badge. Data from `get_portfolio_summary_full` — zero JS aggregation.
  - Cron health panel (Admin only) via `/api/admin/cron-health`
  - Manager briefing (collapsible — starts collapsed):
    - **Ops Manager**: today's production RAG, MTD production RAG, dispatch ratio, breakage, machines, overdue ops tasks
    - **Finance Manager**: per-company cash position freshness, cash trend, net flow, outstanding receivables, overdue stages, finance tasks
  - Notification bell badges update in real-time via Supabase channels
- **Date selector (CEO/Admin):** Allows viewing the dashboard as of any date up to 90 days back. All data sections respect the selected date:
  - Production/dispatch/breakage entries: filtered `<= selectedDate`
  - Investment portfolio: calls `get_portfolio_summary_full(selectedDate, -3, 7)` — returns totals, per-ticker rows, losers, day-change, dividend count in one round-trip. No JS aggregation.
  - Cash positions: filtered `<= selectedDate` (most recent 30 entries up to that date)
  - Cash plan and budget month: derived from `selectedDate.slice(0,7)` (not today)
- **Performance (sessionStorage cache):** `loadExecutiveData` caches the full payload for 2 minutes per date key (`exec_home_YYYY-MM-DD`). Cache is busted on any Supabase Realtime change. Cache not served if `payload.investmentData` is falsy (prevents stale null from hiding the investment section).
- **Global search (AuthWrapper):** Tasks/members/meetings fetched once per session into `searchCacheRef` (useRef). Subsequent searches filter in memory — no DB queries after first load.

#### `/my-dashboard`
- **File:** `app/my-dashboard/page.tsx`
- **Access:** All authenticated users
- Personal task summary — own tasks by status.

#### `/profile`
- **File:** `app/profile/page.tsx`
- **Access:** All authenticated users
- Change display name, password, notification preferences (email/WhatsApp toggle).

#### `/executive`
- **File:** `app/executive/page.tsx` + `EscalationTrafficLights.tsx`
- **Access:** Admin/CEO ONLY (`useRequireCapability("executive")`)
- **What it does:** Cross-company executive overview — production/dispatch/breakage escalations shown as traffic light count cards (Production, Dispatch, Breakage metrics). Click a card to see which plants have issues.

#### `/pa`
- **File:** `app/pa/page.tsx`
- **Access:** PA (Sundas) + Admin/CEO (`useRequireCapability("pa_dashboard")`)
- **What it does:** PA operating hub — pending tasks, notes, delegations, calendar appointments.
  - **Dividend calendar** (confirmed only): shows ticker, ex-date, payment date, and coloured days badge (green >7d, amber ≤7d, red ≤3d) for confirmed dividends due in the next 14 days. **No financial figures, no prices, no payout amounts** — dates and tickers only. PA must never see financial data.

#### `/dashboard`
- **File:** `app/dashboard/page.tsx` → `DashboardView.tsx`
- **Access:** Admin/CEO + Ops dept (`useRequireCapability("operations")`)
- **What it does:**
  - Per-plant KPI cards: today's production/dispatch, month-to-date achievement vs target, breakage rate
  - Bar charts (Recharts): production by plant, dispatch by plant
  - Stock by Customer PO section: per-plant PO cards with fulfillment bars and letter exhaustion warnings
  - Tabbed detail: Tasks (ops dept tasks), Machine Issues, Breakage Pareto (horizontal bars by plant)
  - Monthly targets editing via MonthlyTargets.tsx
  - CSV export

#### `/finance`
- **File:** `app/finance/page.tsx`
- **Access:** Admin/CEO + Finance Managers (`useRequireCapability("finance")`)
- **What it does:**
  - Company picker cards (UTPL → `/finance/unze-trading`, IFPL → `/finance/imperial`)
  - Department budgets section — add/delete/import/export
  - Bulk upload PDFs (Admin/CEO only)
  - Gmail check inbox (Admin/CEO only)

#### `/finance/[company]` (unze-trading or imperial)
- **File:** `app/finance/[company]/page.tsx` → `FinanceManager.tsx`
- **Access:** Admin/CEO + Finance Managers (scoped by company)
- **What it does:**
  - Opening balance display + edit button
  - Monthly cash plan (planned receivables/payouts) edit
  - Daily cash position: add manually or via PDF upload / Gmail auto-ingestion
  - Historical positions table with reconciliation status
  - Charts: closing balance trend, receipts vs payments
  - Monthly budgets table with variance progress bars
  - **Imperial-specific:** closing_after_post_dated = closing_balance + post_dated_total (adds)
  - **UTPL-specific:** closing_after_post_dated = closing_balance − post_dated_total (subtracts)

#### `/receivables`
- **File:** `app/receivables/page.tsx`
- **Access:** Admin/CEO + Finance Mgrs + Ops Mgrs (view); Ops dept ONLY (edit)
- **What it does:**
  - Horizontal pipeline bar showing bills at each stage with RAG colouring
  - Kanban board: columns = receivable stages, cards = bills
  - HTML5 drag-and-drop between columns
  - Add new bill form (Ops dept only)
  - Collection velocity: average days per stage vs working_day_budget
  - Bills grouped by plant in collected section

#### `/investments`
- **File:** `app/investments/page.tsx`
- **Access:** CEO + Admin (edit); PA (view-only)
- **What it does:**
  - PSX portfolio holdings table: ticker, qty, avg cost, current price, current value, P&L, P&L %
  - Add/edit/delete holdings (Admin/CEO only)
  - Refresh prices via `/api/investments/update-prices` (Admin/CEO only)
  - Portfolio totals (from DB — no JS aggregation): total cost, total value, total gain/loss, today's change vs yesterday
  - Alert banner: any stock down more than 3% shown in red (threshold = -3, computed in DB)
  - **Dividends section** (collapsible, Admin/CEO only to edit):
    - Confirmed upcoming dividends table: ticker, Rs/share, ex-date, payment date, days countdown, estimated payout
    - Unconfirmed review queue: auto-fetched PSX entries shown amber with Confirm/Dismiss buttons
    - Add/edit dividend form: ticker dropdown (from holdings), Rs/share, ex-date, payment date, notes
    - All manual entries saved as confirmed=true, source='manual'
  - **Today's Change card**: appears in summary grid once the daily cron has run and populated yesterday's snapshot
- **Data loading:** Single call to `get_portfolio_summary_full` RPC returns all totals, per-ticker rows, losers, and day-change. Holdings table fetched separately for lot-level edit/delete UI. Price history fetched separately for the chart only.
- **Price updates:** Automated via cron — 04:30 UTC (9:30am PKT) and 11:00 UTC (4:00pm PKT), Monday–Friday. Prices stored in `price_history`. Source: PSX DPS API (`/timeseries/eod/{ticker}`), Yahoo Finance as fallback.
- **Historical portfolio value:** Investments page has a date picker — selecting a past date calls `get_portfolio_summary_full` with that date, showing the portfolio as it was then.

#### `/opening-balances`
- **File:** `app/opening-balances/page.tsx` + `OpeningBalancesForm.tsx`
- **Access:** Finance viewers (`useRequireCapability("finance")`)
- **What it does:** Set starting balances per company (cash_opening_balance table).

#### `/production`
- **File:** `app/production/page.tsx` + `ProductionForm.tsx`
- **Access:** Admin/CEO + Ops dept (`useRequireCapability("daily_entry")`)
- **What it does:**
  - Daily production entry: sizes 31, 36, 45, meter — with PO allocation card picker
  - Dispatch entry: authority letter number lookup (600ms debounce) → shows contractor, PO, remaining balances → enter qty + released_by + vehicle_number
  - Dual-write on dispatch: `dispatch_entries` (legacy) AND `dispatch_records` (stock system)
  - Breakage entry
  - Machine issue logging
  - Quick-add receivable bill (ReceivablesSection.tsx)
  - UNIQUE per plant per day — existing entry loads for editing

#### `/stock`
- **File:** `app/stock/page.tsx`
- **Access:** Admin/CEO + Ops dept (`useRequireCapability("stock")`)
- **What it does:**
  - Plant selector buttons
  - Stats strip: total in stock, active POs, all POs
  - Collapsible tree: PO → Contractor → Letter → balances
  - Per-PO: ordered/produced/dispatched/in-stock, fulfillment %
  - Authority letter exhaustion warnings (< 10% remaining → red badge)
  - Closed POs shown at 0.55 opacity

#### `/stock/manage`
- **File:** `app/stock/manage/page.tsx`
- **Access:** Admin/CEO + Ops dept (view); Ops Managers + Admin (write)
- **What it does:**
  - Create POs: customer name, PO number, label, ordered qty per size, opening produced (backfill), start date, notes
  - Issue authority letters: pick PO → pick contractor → letter number, date, issued_by, qty, opening dispatched (backfill), expiry date
  - Add contractors: name, CNIC, phone, address
  - Close PO action

#### `/tasks`
- **File:** `app/tasks/page.tsx` → `TasksPageClient.tsx` + `TasksList.tsx`
- **Access:** All authenticated users
- **What it does:**
  - View switcher: Department (default), Weekly, Monthly, Quarterly, Timeline
  - **Department view**: tasks grouped by `assigned_to_department` with person breakdown chips, overdue highlighting
  - **Timeline view**: SVG Gantt-style visualisation of tasks by due date
  - New task form: description, owner, due_date (required), priority, department, project
  - Task ownership: protected tasks show limited edit options for assignees
  - `canSeeAllTasks` determines if all tasks are shown or just own

#### `/calendar`
- **File:** `app/calendar/page.tsx`
- **Access:** All authenticated users
- Shows tasks by due date in a calendar layout.

#### `/meetings`
- **File:** `app/meetings/page.tsx`
- **Access:** Privileged users only (`useRequireCapability("meetings_admin")`)
- **What it does:**
  - **Past Meetings tab**: all meetings with attendees, summary, decisions, tasks. Expandable cards sorted newest first. PDF download for Admin/CEO/PA.
  - **Decision Log tab**: aggregated decisions from all meetings, searchable by department.
  - Create meeting: paste transcript / upload PDF or DOCX / check Gmail inbox
  - AI extraction via Claude API: title, date, company, dept, attendees, summary, decisions, risks, action items
  - Review & edit step: amend all fields, add action items (description, owner, due date all required)
  - Approve: saves meeting, creates tasks, sends in-app notifications; email option per attendee
  - Meeting Action Tracker: progress bar per meeting (completed/total tasks)

#### `/my-minutes`
- **File:** `app/my-minutes/page.tsx`
- **Access:** All authenticated users
- **What it does:** Personal meeting minutes — meetings where user is attendee OR has tasks. Sort: newest first. Copy protection for non-privileged users (user-select: none + onCopy blocked). PDF download for Admin/CEO/PA.

#### `/recurring-tasks`
- **File:** `app/recurring-tasks/page.tsx`
- **Access:** Privileged (`useRequireCapability("recurring_tasks")`)
- Manage recurring task templates: frequency (weekly/monthly/quarterly), day, assignee, due_days_after.

#### `/members`
- **File:** `app/members/page.tsx` + `MembersManager.tsx` + `AccessMatrix.tsx`
- **Access:** Privileged (`useRequireCapability("members")`)
- **What it does:**
  - Members list with role, department, company
  - Invite new member (sends email)
  - Edit role, department, company, name
  - Delete member (protected emails cannot be deleted)
  - Access Matrix tab: per-member boolean permission overrides (toggle grid)

#### `/audit-log`
- **File:** `app/audit-log/page.tsx`
- **Access:** Privileged (`useRequireCapability("audit_log")`)
- System activity trail from `audit_log` table — who did what and when.

#### `/exceptions`
- **File:** `app/exceptions/page.tsx`
- **Access:** Privileged (`useRequireCapability("exceptions")`)
- Exception management and alerts — surfaced rule violations.

#### `/admin`
- **File:** `app/admin/page.tsx`
- **Access:** `khuram1901@gmail.com` ONLY (`isMainAdmin`) — not even other Admins/CEO
- **What it does:** Source document archive, manual and list backups, restore from backup, wipe selected data.

#### `/monthly-operations-targets`
- **File:** `app/monthly-operations-targets/page.tsx`
- **Access:** Privileged + Ops HoD (nadeem.khan@unze.co.uk)
- Set monthly production/dispatch targets per plant.

#### `/department/[slug]`
- **File:** `app/department/[slug]/page.tsx` + sub-dashboards
- **Access:** Admin/CEO + Manager of that specific department (`useRequireDepartment(dept)`)
- Slugs and dashboards:
  - `hr` → `HRDashboard.tsx` — recruitment positions, performance evaluations, strategy goals
  - `taxation` → `TaxationDashboard.tsx` — legal notices (notice_type='tax')
  - `audit` → `AuditDashboard.tsx` — audit plan items, findings
  - `admin` → `AdminDashboard.tsx` — admin categories and spend
  - `it` → `DepartmentDashboard.tsx` (default) — department tasks and notices
  - `legal` → `DepartmentDashboard.tsx` + legal_notices (notice_type='legal')

---

## 7. Business Rules

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
| Production cap per PO | Produced ≤ ordered × 1.03 (3% buffer). Excess goes to "Unze Owned / Unallocated" PO |
| Letter cap | Sum of all authority letters for a PO ≤ ordered qty exactly (no buffer) |
| Dispatch hard block | Cannot dispatch more than letter's remaining balance |
| Letter exhaustion warning | Remaining < 10% of authorised qty → red badge |
| PO auto-close trigger | After each dispatch_record insert, if dispatched ≥ ordered for ALL sizes → PO status = 'Closed' |

#### KPI Fulfilment Bars (Stock)
| Fulfillment % | Colour |
|---------------|--------|
| ≥90% | GREEN |
| ≥60% | AMBER |
| <60% | RED |

### Auto-Task Creation Rules
1. **Recurring tasks cron** (`/api/tasks/recurring`) — creates tasks on schedule per `recurring_tasks.frequency` and `day_of_week` / `day_of_month`. `assigned_by_email` = admin email → always protected.
2. **Meeting approval** — creates tasks from action items. `assigned_by_email` = approver email → always protected.

### Receivables Business Rules
- **Bill types**: Normal, Sales Tax, Retention
  - Sales Tax and Retention bills **skip** the IC & GRN stage
- **Stage budget**: `working_day_budget` days per stage. Bills past this are overdue.
- **Editing stages**: Ops dept only (`canEditReceivables`). Finance managers view-only.
- **Moving stages**: forward and backward both permitted via drag or buttons.

### Finance Rules
- **IFPL post-dated**: `closing_after_post_dated = closing_balance + post_dated_total`
- **UTPL post-dated**: `closing_after_post_dated = closing_balance − post_dated_total`
- **Cash burn rate**: "X days runway at current burn rate" shown when 7-day net outflows persist
- **Budget variance bars**: Amber threshold at 80% spent, Red at 100%+

### Meeting Rules
- "General" label renamed "Executive Office" everywhere — never use "General"
- AI extraction from Claude API: required fields per action item = description, owner, due date
- Red highlight on missing required fields before approval
- Company attendees get in-app minutes (My Minutes) by default — email opt-in
- External attendees pre-checked for email

### Task Rules
- **Due date is REQUIRED** on every task — no open-ended tasks
- Protected task (created by Admin/CEO/PA) — assignee can only update status, add completion notes; cannot edit description, change due date, reassign, or delete
- `canSeeAllTasks`: Privileged → all tasks; Manager → own department tasks + own; Member → own only

### Dual-Write for Dispatch
**NEVER remove either write.** Daily entry dispatch form writes to BOTH:
1. `dispatch_entries` — legacy ops dashboard calculations depend on this
2. `dispatch_records` (via `/api/stock/dispatch-records`) — stock system PO/letter balance calculations

---

## 8. Data Flows

### Finance Data Flow
Three ingestion paths — all end in `daily_cash_position` + `bank_position_snapshots`:

**Path 1 — Google Drive (primary, fully automated)**
1. Gmail receives cash sheet email with PDF attachments
2. Google Apps Script (runs hourly at script.google.com under k.saleem@unzegroup.com) picks up unread PDFs → drops into Google Drive folder **Cockpit Cash Sheets/Drop Here** (folder ID: `140RkdEgn0JSi67gpjswr1L-lidClriJ1`)
3. `/api/finance/check-drive` cron (every 10 min) reads PDFs from Drop Here, pairs cash flow + bank position by date/company prefix, parses both, saves to DB, moves files to **Processed** folder
4. Company detected from PDF content by `detectCompany()` — checks Unze markers BEFORE Imperial (Unze sheets list Imperial as payee)

**Path 2 — Manual upload**
1. Admin goes to `/finance/upload` (Upload Cash Sheets page)
2. Drag-and-drops PDFs → POST to `/api/finance/upload-pdfs` → same parsing + save logic

**Path 3 — Gmail direct (legacy)**
1. `/api/finance/check-inbox` cron checks k.saleem@unzegroup.com inbox for cockpit-cash label

**All paths:**
- Source PDFs archived → `document_archive` table + Supabase Storage `source-documents` bucket
- Finance Manager views via `/finance/[company]` — data scoped by `company_id`
- Forecast entered manually or via Excel upload → `monthly_cash_plan`
- Department budgets: admin enters per-department monthly budgets → `department_budgets`

**PDF parsing rules:**
- `detectCompany()` checks Unze markers first (`opening balance total`, `closing balance unze trading`, `unze trading pvt`) then Imperial (`today opening balance` + `today closing balance`, `imperial footwear`)
- `parseImperial()` uses `extractInlineAmount()` for values glued directly to labels e.g. `Today Opening Balance(16,333,132)`
- Imperial: splits at `DatePayments` / `DateReceipts` to extract correct section totals
- UTPL `closing_after_post_dated = closing_balance − post_dated_total`; IFPL `closing_after_post_dated = closing_balance + post_dated_total`

**Google Drive folder setup (one-time):**
Run: `curl -H 'Authorization: Bearer unze-cockpit-cron-2026' https://pulse.unze.co.uk/api/finance/setup-drive-folder`
Requires: `app_settings` table (migration 052) + Google reconnected with Drive scope

### Production/Stock Data Flow
1. Plant member opens `/production` → selects plant
2. Enters production qty → picks PO card → saves to `production_entries` + `production_allocations`
3. Enters dispatch qty → types authority letter number → lookup debounce → shows remaining balances → saves to `dispatch_entries` (legacy) AND `dispatch_records` (stock system)
4. API `/api/stock/dispatch-records` POST validates cap → auto-closes PO if fulfilled
5. `/stock` page fetches `/api/stock/summary?plantId=X` → shows full tree with running balances
6. Ops Dashboard fetches summary for all plants → shows "Stock by Customer PO" section

### Meeting Minutes Data Flow
1. Admin pastes transcript or uploads PDF/DOCX or checks Gmail
2. `/api/meetings/extract` sends to Claude API → returns structured JSON
3. Admin reviews, edits action items on step 2
4. Approve → saves to `meetings`, creates `tasks`, links via `meeting_tasks`, saves `meeting_attendees`
5. Notification sent to attendees (in-app via My Minutes; email optional)
6. Company attendees see minutes in `/my-minutes`; privileged users see all in `/meetings`

### Task Data Flow
1. Task created (form / meeting approval / recurring cron)
2. Assignee sees task in `/tasks` or `/my-dashboard`
3. Notification bell updates (Supabase real-time channel on `tasks`)
4. Assignee updates status → if protected task, only status + notes allowed
5. Manager/Admin reviews via `/tasks` or ops dashboard
6. Weekly digest email aggregates task stats

### Exception Escalation Flow
1. Cron jobs run daily/weekly reports
2. Metrics checked against thresholds (production, dispatch, breakage, cash)
3. Exceptions surfaced on `/exceptions` page and in manager briefings on home page
4. EscalationTrafficLights component on `/executive` shows count by metric type

### Notification Flow
1. Task creation → `/api/notifications/send` → email to assignee
2. Meeting approval → minutes notification to attendees
3. Push subscription registered via `/api/notifications/push-subscribe` → stored in `push_subscriptions`
4. Push sent via `/api/notifications/push` using VAPID/web-push

---

## 9. Integration Points

### Google / Gmail
| What | Flow |
|------|------|
| Gmail finance PDF ingestion | Admin connects Google account via `/api/google/auth` → OAuth2 callback stores encrypted tokens in `google_oauth_tokens` → `/api/finance/check-inbox` polls Gmail for PDFs |
| Google Calendar events | `/api/calendar/create-event` creates events; `/api/calendar/freebusy` checks availability |
| Meeting minutes from Gmail | `/api/meetings/check-inbox` reads meeting emails → stores in `pending_minutes` → admin reviews |
| Token storage | Encrypted (AES via `lib/crypto.ts`, key from ENCRYPTION_KEY env var) in `google_oauth_tokens` |
| Token refresh | Optimistic lock via `updated_at` to prevent race conditions |
| Two OAuth apps | One for finance Gmail; separate `GOOGLE_NOTIFICATION_*` credentials for push notifications |

### Anthropic / Claude API
- **Endpoint:** `/api/meetings/extract`
- **Used for:** Extracting structured meeting data (title, date, attendees, decisions, risks, opportunities, action items) from raw transcript or parsed PDF text
- **Model:** Configured in route; key from `ANTHROPIC_API_KEY`
- **Guard:** Requires Supabase auth session (prevents abuse)

### Web Push Notifications
- **Library:** `web-push` (^3.6.7)
- **Keys:** VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL
- **Flow:** Browser registers → `/api/notifications/push-subscribe` validates email from session → stores in `push_subscriptions` → server sends via `/api/notifications/push`

### Cron Jobs (all routes protected by `CRON_SECRET` header)
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
| `/api/investments/update-prices` | 04:30 Mon–Fri | PSX market open (9:30am PKT) — opening prices |
| `/api/investments/update-prices` | 11:00 Mon–Fri | PSX market close (4:00pm PKT) — closing prices |
| `/api/investments/daily-summary` | 05:00 Mon–Fri | Portfolio summary: calls `get_portfolio_daily_summary` RPC, upserts to `portfolio_snapshots`, emails Khuram |
| `/api/investments/fetch-dividends` | 06:00 Mon–Fri | PSX dividend auto-fetch: scrapes `/payouts` per holding ticker, inserts unconfirmed entries to `stock_dividends` |
| `/api/reports/monthly-po` | 06:00 1st of month | Monthly PO progress report email |

> If `CRON_SECRET` env var is missing, ALL cron requests are blocked (migration 001-era security fix).

### Supabase Storage
- **Bucket:** `source-documents` — stores uploaded PDFs
- **Backups:** Separate bucket for database backups (managed via `/api/backup`)

---

## 10. Decisions Locked In

1. **Inline styles, not Tailwind** — the codebase is intentionally inline-styled. Tailwind is installed as a dev dependency but not used at runtime.
2. **NEVER auto-run SQL migrations** — all `.sql` files in `supabase/` are applied manually via Supabase SQL Editor.
3. **PA (Executive role) never sees financial data** — this is enforced at the permission function level (isPA returns false for canViewFinance), at the RLS level (is_admin_or_exec now excludes Executive), and in the sidebar (finance cards hidden).
4. **Multi-company: UTPL and IFPL are separate** — never mix their `company_id` data. Finance pages always filter by company_id.
5. **Management by exception** — dashboards show status and exceptions, not raw data. KPI cards with RAG colouring, not raw tables.
6. **Dual-write for dispatch** — production dispatch writes to BOTH `dispatch_entries` (legacy) AND `dispatch_records` (stock system). Both writes must always remain.
7. **`isAdminTier` vs `canEditFinance`** — system/infrastructure features (Gmail connect, bulk upload) gated behind `isAdminTier`. Data entry features gated behind `canEditFinance`. Never swap these.
8. **"General" → "Executive Office"** — all department/company labels use "Executive Office" for cross-department/cross-company items. "General" is banned.
9. **Dates always DD/MM/YYYY** — via `formatDateUK()`. Never inline format dates.
10. **British English** — all user-facing copy uses British English.
11. **`overflowX: hidden` banned on `<main>` tags** — clips kanban scroll containers. Use `overflowX: auto` with `minWidth: 0`.
12. **Due date required on all tasks** — no open-ended tasks. Enforced in NewTaskForm.
13. **Protected tasks cannot be edited by assignees** — only status + notes updates allowed on tasks created by Admin/CEO/PA.
14. **`useToast()` returns `{ show, element }`** — not `{ toast, element }`. Do not break this API.
15. **`createServiceClient()`** for all API route DB writes — bypasses RLS; never use anon client for writes in server routes.
16. **`requireAuth(req)`** called first in every API route — validates Bearer token before any logic.
17. **Ops HoD (nadeem.khan@unze.co.uk)** can edit operations targets even without Admin/Executive role.
18. **Never use `<input type="date">`** — Safari ignores `lang="en-GB"` and always shows MM/DD/YYYY. Always use `<DateInput>` from `app/lib/DateInput.tsx`. It has an identical interface to native date inputs (value: YYYY-MM-DD, onChange fires YYYY-MM-DD) but displays in DD/MM/YYYY.
19. **Sidebar group order is fixed: Finance → Departments → Operations → Tasks & Meetings → Settings.** "Command Centre" group is removed — it only ever contained PA Dashboard which Admin/CEO never see. Items within each group are sorted A–Z case-insensitively at render time. Do not re-add "Command Centre" or change the group order without a deliberate decision.
20. **All sensitive API routes must have server-side role checks in addition to UI gates** — defence-in-depth. Pattern: call `requireAuth(req)` first, then check role and return 403 immediately if not in the allowed list. The Bank Facilities routes (`/api/finance/guarantees` and `/api/finance/guarantee-facilities`) are the reference implementation.

---

## 11. Known Issues and Open Questions

| # | Issue | Status |
|---|-------|--------|
| 19 | No server-side middleware.ts for route protection | Open — all guards are client-side only |
| 20 | In-memory rate limiter resets on Vercel cold starts | Open — needs Redis/KV for persistence |
| 50–64 | 15 low-priority upgrade items from June 2026 audit | Not started |
| — | `isAdmin` in `finance/page.tsx` vs `userIsAdmin` in `FinanceManager.tsx` confusingly use different underlying permission checks | Tech debt — functional but confusing |
| — | Section spacing not standardised across all pages | 14px dominant; bulk replace deferred pending visual QA |
| — | Ops dashboard missing stale-data banner | Home and finance have it; ops dashboard deferred |

---

## 12. Recovery Instructions

If the entire project disappeared tomorrow, rebuild it as follows:

### Step 1: Restore the code
```
git clone <repo-url>
npm install
```

### Step 2: Restore the database
1. Log in to Supabase dashboard → create a new project
2. Note the project URL and keys
3. Run all SQL migration files in order (001 through 049) via the Supabase SQL Editor
4. Restore data from the most recent backup (available in Supabase Storage or via the `/admin` page backup list)

### Step 3: Configure environment
Set all environment variables in Vercel (see Section 1):
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- ANTHROPIC_API_KEY
- CRON_SECRET (generate a random secret)
- GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
- GOOGLE_NOTIFICATION_* equivalents
- VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL (regenerate via web-push)
- ENCRYPTION_KEY (32-byte hex string — **if changed, existing OAuth tokens cannot be decrypted**)

### Step 4: Deploy
```
vercel deploy --prod
```

### Step 5: Reconnect integrations
1. Log in as khuram1901@gmail.com
2. Go to Finance page → reconnect Gmail account via Google OAuth
3. Verify cron routes respond correctly to CRON_SECRET
4. Verify push notifications work

### Step 6: Seed data
The database backup should restore all existing data. If starting fresh:
- Run `supabase/035_seed_investments.sql` for investment seed data
- Run `supabase/041_receivable_stages_seed.sql` to seed receivable stages
- Create initial members via `/members` page
- Set company data manually in `/admin`

### Key files to understand the app
1. `BLUEPRINT.md` — this document
2. `app/lib/permissions.ts` — all access control
3. `app/lib/pageRegistry.ts` — all pages and their permission keys
4. `app/lib/SharedUI.tsx` — all design tokens and components
5. `app/lib/constants.ts` — company IDs
6. `supabase/` migration files — complete database schema

---

*Blueprint created: 01/07/2026. Maintained by the blueprint-keeper agent. Always keep this accurate — it is the rebuilding guide.*
