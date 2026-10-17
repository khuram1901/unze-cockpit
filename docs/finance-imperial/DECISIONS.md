# Imperial Footwear finance page (`/finance/imperial`) — Decisions

Source of truth for the Finance Overview tab. The Retail Sales tab is governed by
`docs/retail-sales/DECISIONS.md`. Created 17/10/2026 from the page audit + fix session.

## Production
- Commits `15eee01b`, `c8fe31e5`, `b83cab8f`, `f08568cf`, `f7c27a33`, `87d024a9` on main.
- Rollback: `fc482874` (deployment `unze-cockpit-g2spqofcp`).
- Migrations applied 17/10/2026: **273** (cash position guard trigger), **274** (finance RLS view vs edit + scope fix), **275** (retail month totals RPC). Rollback in each file.

## Who has access
- Finance Overview: finance role (scope `both` or `IFPL`), Admin/CEO, or widget `imperial.finance_overview` (widget-only users currently get an empty page — reads go direct to Supabase under RLS; see open items).
- Retail Sales: Admin/CEO or widget `imperial.retail_sales` (HOD: `imperial.retail_sales_hod`).
- Live (17/10/2026): Khuram, Kamran, Shakeel (both + edit), Shahida (IFPL + edit + all widgets), Abbasi (IFPL, view only), Haba (retail widgets). Sania is UTPL only. PA never.

## Rules
- **Every** write to `daily_cash_position` passes `daily_cash_position_guard()`: opening + receipts − payments = closing (±100), opening = previous day's closing (±100), closing = next day's opening (±100). Rejections raise "Cash sheet rejected …" and the API returns **422** with that message. Six upload paths exist (parse-cash-flow, upload-pdfs, bulk-upload, check-inbox, check-drive, banking/cash-sheets) — the trigger covers all of them.
- Deliberate corrections only via SQL with `select set_config('cash_position.skip_continuity','true',true);` in the same transaction.
- Finance tables (`cash_opening_balance`, `monthly_cash_plan`, `monthly_budgets`, `daily_cash_position`): read = `can_see_company_finance()`, write/delete = `can_edit_company_finance()` (mirrors `canEditFinance()`: explicit `can_edit_finance` override wins, else view implies edit).
- `finance_company_scope` is a short code (`UTPL` / `IFPL` / `both`) and is compared to `companies.short_code`.
- Retail Sales footer totals come from `get_daily_sales_month_totals()` — never summed in JS.
- Chart axes: dates DD/MM (`axisDate`), money via `axisPKR` (handles negatives). Cards/table use `formatPKR`.
- Banner: red = continuity breaks only; amber = setup/staleness.

## Data corrections log
- 24/09/2026 IFPL: parser had stored opening 0 / receipts 14,286,776 / payments 0. Corrected from the stored PDF (`IFPL/2026/2026-09-24.pdf`): opening −12,156,523, receipts 15,320,269, payments 14,286,776, closing −11,123,030, PDC 150,486,854, after-PDC −161,609,884. Chain now clean (0 breaks). Uploaded by Waleed 16/10/2026 via Banking manual upload.

## Open items
- IFPL has no `cash_opening_balance` or `monthly_cash_plan` rows → three "Not set" cards. Business input needed (Shakeel).
- Widget-only Finance Overview users see an empty page (reads bypass the API). Fix = move FinanceManager reads behind an API route. ~1–2 h. Nobody affected today.
- Baranh has one old chain break (06→07 Aug 2026) — predates the trigger; fix from the source sheet when convenient.
- Email Waleed/Shakeel when an upload is rejected (improvement, not built).
- `is_finance_manager()` still checks `department = 'Finance'` (no such department) — effectively admin-only. Left alone (also used by department_budgets policies).
