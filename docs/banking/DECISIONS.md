# Banking page (`/banking`) — Decisions

Source of truth for the Banking page. Created 18/10/2026 from the page audit + fix session.

## Purpose (Khuram, 18/10/2026)
- **EOBI & SS tab** — Waleed records monthly EOBI / Social Security payments per entity; the same data feeds the HR and Admin Operations pages.
- **Cash Sheet tab** — Waleed uploads each company's daily bank cash sheet PDF. The app must pick up opening balance, receipts, payments, closing balance, post-dated cheques and net closing, and feed the *Daily Positions* section of `/finance/unze-trading`, `/finance/imperial` and `/finance/restaurants`.
- All calculations in Supabase. Previous day's closing must match the day's opening; the page alerts on breaks.

## Access
- Page: Admin/CEO tier, or the `can_access_banking` toggle. Tabs via widgets `banking.eobi_ss` / `banking.cash_sheet` (default on).
- Live: Khuram, Kamran, Waleed, plus Abbasi, Sania, Shahida, Shakeel (kept, per Khuram 18/10). PA never.
- Server: `app/lib/banking-access.ts` is the only access check for `/api/banking/*` and `/api/admin/payments` (role-aware; mirrors `canAccessBanking()`). Restaurants-P&L users may *read* BRNH/HD/KKJ sheets.

## Rules
- **Source of truth for a day's figures is `daily_cash_position`** (validated by `daily_cash_position_guard()`, migration 273). `cash_sheet_uploads` holds the PDF, lines and notes; its totals are mirrored from the position by trigger (migration 276). Banking's continuity alerts and Finance's are the same function.
- **Save order is fail-safe:** position first (guard validates arithmetic + chain with neighbouring days, ±100), then sheet header, lines, PDC buckets. A rejected position saves nothing and returns 422 with the guard's message.
- **Parse step names its problems** (`/api/banking/cash-sheets/pdf/parse` → `checks[]`): unreadable figure(s), figures don't add up, opening ≠ previous available day's closing (weekends/holidays are simply the previous row), PDF detected as another company's sheet. The form shows them and stops; typing all four figures overrides the PDF.
- Line sums/counts come from the `cash_sheet_uploads_with_totals` view — never summed in the page.
- PKR via `formatPKR`; dates via `formatDateUK` / `DateInput`.

## Migrations
276 (mirror trigger, reconcile, continuity, EOBI RLS, totals view). Depends on 273. Rollback in file.

## Data corrections log
- 18/10/2026: 11 drifted days (UTPL 5, IFPL 3, BRNH 2) and 59 sheets with missing totals reconciled from `daily_cash_position`. IFPL 24/06/2026 sheet row had held UTPL's numbers (mis-filed PDF) — totals now correct; the stored PDF at `IFPL/2026/2026-06-24.pdf` may still be the UTPL file.

## Open items
- Parser accuracy per company format: run the parser over the stored PDFs (`cash-sheets` bucket) in a session with network access and fix the per-company patterns that miss opening/closing. The checks now make every miss visible at upload time.
- Baranh chain break 06→07/08/2026 (pre-dates the guard) — fix from the source sheet.
- Email Waleed when a cron-ingested sheet is rejected by the guard (today it only logs).
- Live test-user run for this page not done (page is CEO/toggle-gated; test.manager has no toggle → redirect expected).
