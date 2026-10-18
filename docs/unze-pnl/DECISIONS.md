# Unze P&L page (`/finance/profit-and-loss`) — Decisions

Source of truth for the Unze Trading P&L + Balance Sheet page. Created 18/10/2026 from the page audit + fix session (migration 279). Same principles as `docs/imperial-pnl/DECISIONS.md` — the only difference is plants instead of stores/channels.

## Purpose (Khuram, 18/10/2026)
- Correct Unze Trading figures for the period selected: headline cards, plant scoreboard, cost structure, expense movement, AI commentary — all changing with the period and plant.
- Plants: FEDMIC, MEPCO, PESCO, **Smart Meters** (added 18/10/2026 — its own P&L and Balance Sheet), with HO as the cost centre.
- Rejected uploads visible with the reason; re-upload replaces and says so.

## Access
- **Strictly Khuram, Kamran, Sania and Shakeel.** `canViewUnzePnl()`: PA never; Access Matrix toggle `can_view_unze_pnl`; otherwise Admin/CEO (incl. main admin email). Live: Khuram and Kamran by role, Sania and Shakeel by toggle (set 18/10/2026). Abbasi and Shahida (IFPL finance) are refused.
- Database mirrors the page: every `pnl_*`, `utpl_*` and balance-sheet RPC calls `assert_company_finance_access(company)` → `can_view_unze_pnl_db()` for UTPL. Server routes (service role) pass through. `get_pnl_commentary` / `get_pnl_restatements` check per company.
- Uploads (P&L and Balance Sheet) need the page right **and** `can_edit_finance`. `/api/pnl/ceo-insights` checks the page right per company.
- Route guard capability `unze_pnl`; sidebar card permKey `can_view_unze_pnl`; Access Matrix label "Unze P&L (UTPL)".
- Widgets: `unze_pnl.attention_banner`, `kpi_cards`, `charts`, `plant_scoreboard`, `true_profit` (new), `expense_watch`, `commentary`, `footer`.

## Rules
- **Plants come from `pnl_plants`** (code, label, is_cost_centre, sort_order). The parser accepts a "Smart Meters" column (spellings: Smart Meters / Smart Meter / SM) and stores it as `SMART METERS`; older workbooks without the column still parse. HO is the only cost centre.
- **Every figure comes from Postgres.** `utpl_period_summary(company, from, to, plant)` returns totals, latest/previous month, run-rate averages, loss streak, plant scoreboard with share of sales, HO cost and % of plant sales, cost structure (% of sales per bucket per month), expense movement (latest vs previous month) and the *Needs attention* list. `utpl_plant_true_profit()` = plant net profit after its share of HO cost (workbook allocation % where present, otherwise sales share). `utpl_data_coverage()` = months loaded / rejected (with reason) / accepted-with-warnings / missing. The page shapes and renders only.
- **Period presets:** Month = current calendar month; Quarter = current fiscal quarter (Jul–Sep, Oct–Dec, Jan–Mar, Apr–Jun); YTD = 1 January → today; fiscal years via Custom. Falls back to the latest data with an amber note when the current period has nothing.
- **Attention list:** months not uploaded, rejected uploads (reason), loss streak (≥2 months urgent), latest month loss, sales > 30% below period average, margin > 5 pts under average (or sold below cost), HO > 10% of plant sales, plants with zero sales in the latest month, months accepted with warnings, restatements in the last 30 days.
- **AI commentary** keyed by period + plant; generated automatically when none is saved; shown only if the view still matches the request.
- **Uploads:** a month is accepted only when every hard check passes (warnings such as "plant had zero sales" are accepted and listed). Result reports `previous_status` → "Data fixed" / "Replaced previous figures (uploaded dd/mm)". Restatements logged.
- **Balance sheet per plant:** `balance_sheet.plant` ("Company" = consolidated). The BS tab has a Statement chooser (Whole company / each plant); the upload form has "Statement for". Unique on (company_id, month, plant).
- PKR prefix on headline figures; DD/MM/YYYY dates; no new colours.

## Migrations
279 (access functions, pnl_plants, guarded RPCs, period summary, true profit, coverage, plant-level BS). Rollback notes in file. Also folds the migration-277 helper hardening (`_ifpl_stores_from`).

## Open items
- Aug 26 and Sep 26 P&L not uploaded; Jun/Jul 26 accepted with "PESCO had zero Gross Sale" warnings — confirm PESCO was idle.
- Smart Meters: no data yet. Confirm the exact column header in the workbook; the parser accepts the spellings above.
- Weekly Security Audit GitHub workflow fails on every run (repo-wide, unrelated).
