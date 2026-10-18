# Imperial P&L page (`/finance/imperial-pnl`) — Decisions

Source of truth for the Imperial Footwear P&L page. Created 18/10/2026 from the page audit + fix session (PRs #38, #39, migration 277).

## Purpose (Khuram, 18/10/2026)
- Show the correct Imperial Footwear plan-vs-actual story for the period selected: headline figures, channel totals, store league, watch list, expense vs plan, AI commentary — all of it changing with the period.
- "Retail" means the retail stores only. The list of stores must be the real list, with no duplicates.
- Rejected uploads must be visible with the reason; re-uploading a month must replace it and say so.

## Access
- Page: `canViewIfplPnl()` — PA never; Access Matrix toggle `can_view_ifpl_pnl`; otherwise Admin/CEO (incl. main admin email). Live holders at 18/10: Khuram, Kamran, Shakeel, Shahida, Abbasi, test.ceo.
- **Database mirrors the page** (migration 277): every IFPL RPC calls `assert_ifpl_pnl_access()` → `can_view_ifpl_pnl_db()`. Server routes (service role) pass through. `get_pnl_commentary` / `get_pnl_restatements` are shared with UTPL and restaurants pages and check per company via `can_view_pnl_company_db(p_company)`. Balance-sheet RPCs use the IFPL check (the page is their only caller).
- `/api/pnl/ceo-insights` checks the same page permission per company.
- Widgets: `imperial_pnl.attention_banner`, `kpi_cards`, `charts`, `branch_league`, `like_for_like` (new), `expense_watch`, `commentary`, `data_strip`.

## Rules
- **Store identity is the master location**, not the branch text in the workbook. `ifpl_pnl_lines_v` keys rows by `location_id` (name from `admin_locations`), and normalises the channel from `location_type`: online → Online PK; office/warehouse → Cost centre; else Retail. `match_pnl_branches()` + `pnl_branch_aliases` map new uploads; an unmapped branch would show under its file text (logged as `branch_unmapped`).
- Live locations: 38 = 34 retail stores + Online + Head Office + Warehouse + Manga Warehouse.
- **Every figure comes from Postgres.** `ifpl_period_summary(from,to,channel,branch)` returns totals, channel totals, stars, watch list, expense watch, below-the-line and the *Needs attention* list. `ifpl_store_league(from,to,sort,desc)` ranks stores and returns the "Other N stores" row. `ifpl_sales_by_fy()` (history in `ifpl_fy_history` + live years). `ifpl_yoy_stores(from,to)` like-for-like. `ifpl_data_coverage()` months / rejected / missing. The page shapes and renders; it never sums.
- **Period presets:** Month = current calendar month; Quarter = current *fiscal* quarter (Jul–Sep, Oct–Dec, Jan–Mar, Apr–Jun); YTD = the rolling 12 months ending in the current month (Nov 25 → Oct 26 when today is Oct 26); fiscal-year views via Custom. When the current period has no accepted data the preset falls back to the latest available data and says so under the filter bar (amber note).
- **Watch list thresholds:** contribution < −100,000 or sales > 20% below plan. Attention list: rejected months, latest month > 10% below plan, GP margin > 2 pts under plan, overheads > 5% over plan, loss-making stores (urgent at 3+), off-plan stores, restatements in the last 30 days.
- **AI commentary** is keyed by period + scope. If none is saved for the view, one is generated automatically; a result is shown only if the view still matches the request. It is fed the same RPC outputs as the cards.
- **Uploads:** a month is accepted only if every blocking check passes (client checks + server recomputation). Accepted → new lines inserted, previous upload(s) for the month deleted last; restatements logged. Result reports `previous_status` so the page says "Data fixed" (was rejected) or "Replaced previous figures (uploaded dd/mm)" (was accepted). Rejected → nothing stored; the data strip and attention list show the failing check until a good upload lands.
- Headline figures carry `PKR`; thousands separators everywhere; negatives in parentheses.

## Like-for-like (new insight, 18/10/2026)
Each store vs the same calendar months one year earlier, counting only months it traded in both years; stores with no comparison are "new" and listed separately. Company LFL = comparable stores only (channel `Total` row). Jul–Aug 26 vs 25: +25.6% across 28 comparable store-months.

## Migrations
277 (access functions, `ifpl_pnl_lines_v`, period summary, store league, FY history table + RPC, like-for-like, coverage). Rollback notes in file.

## Data corrections log
- 18/10/2026: Emporium Mall and Iqbal Town existed twice in `admin_locations` (17/07 and 02/09 records). P&L rows moved onto the 02/09 records (the ones Stores/HR use); 6 compliance + 2 NTN docs repointed; the 17/07 records set inactive and renamed "(duplicate — merged 18/10/26)". Aliases added so future uploads land correctly. Sukkur channel UK → Retail (79 rows; parser matched "uk" inside "sukkur" — now a whole-word match). Head Office `location_type` retail → office. 029 renamed "Mall of Sialkot", 061 renamed "Faisalabad KN".

## Open items
- Sep 26 upload rejected (Operating profit = GP − overheads, out by −319,803) — fix the workbook and re-upload. Oct 26 not yet uploaded.
- The Weekly Security Audit GitHub workflow fails on every run (npm audit, Gitleaks on full history) — unrelated to this page; needs its own session.
- Source-file warnings (24 across months) remain visible in the data strip; they are the workbook's own inconsistencies.
