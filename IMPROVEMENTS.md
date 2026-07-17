# Improvements Log

## 2026-06-28 (Session 2)

### Previous Items Status

From 2026-06-28 (Session 1):
- ✅ **Parallelize price fetcher** — Done. `route.ts` now uses batched `Promise.allSettled` with `BATCH = 5`.
- ✅ **PERM_FUNC duplication** — Still resolved (only `SidebarLayout.tsx`).
- 🔲 **Dark mode migration (~20 pages)** — Still outstanding. `executive/page.tsx` (21× `"white"`), `members/MembersManager.tsx` (17×), `meetings/page.tsx` (20×), `calendar/page.tsx` (11×), `investments/page.tsx` (5×). Fourth consecutive review flagging this.
- 🔲 **Access Matrix accessibility** — Still outstanding (0 `aria-label`/`aria-pressed` in `AccessMatrix.tsx`). Fourth consecutive review.
- 🔲 **Error/empty states on investments page** — Still outstanding. Queries silently return empty arrays on failure.

### Current State Assessment

Major UX session landed: CEO home page redesigned with strategic KPIs, quick-access cards, and collapsible tasks. PA page got a donut chart and greeting. Sidebar font sizes bumped 13→15px, icons 16→18px. Back button changed from `history.back()` to always navigate `/home`. Calendar page removed "Tasks Due This Week" section and added Google Calendar diagnostic banner. Google account consolidation from `unzegrouppk@gmail.com` to `khuram1901@gmail.com`. Investments page now shows "Prices last updated" timestamp.

The app's usability improved noticeably, but a **font-size inconsistency gap** has opened: the sidebar was bumped to 15px, but the home page content still uses 11–14px heavily (30 instances of 11–12px), and the `PageHeader` "Home" button is still 13px. The body `font-size: 16px` in `globals.css` has no effect on inline-styled components (which is everything), so the user's readability concern is only partially addressed.

### Design Inconsistencies & Issues Found

1. **Font-size mismatch between sidebar and page content.** Sidebar nav items are now 15px, but the home page has 33× `14px`, 15× `13px`, 16× `11px`. The `PageHeader` "Home" button is 13px (`SharedUI.tsx:107`). CEO quick-access card descriptions are 12px. This creates a visible jump — the sidebar is comfortable, then content shrinks. Other pages are worse: `FinanceManager.tsx` has 22 instances of 11–12px, `MembersManager.tsx` has 18, `meetings/page.tsx` has 17.

2. **`PageHeader` no longer renders title/subtitle — but still accepts them.** After the SidebarLayout header was added, `PageHeader` was reduced to just the "Home" button. But 20+ pages still pass `title` and `subtitle` props (which are destructured as `_title` and `_subtitle` and ignored). This is dead code that misleads contributors into thinking the component renders a heading.

3. **CEO collapsible tasks header lacks keyboard accessibility.** `home/page.tsx:423` uses `onClick` on a plain `<div>` with `cursor: "pointer"` — no `role="button"`, no `tabIndex`, no `onKeyDown`. Keyboard users can't expand/collapse the tasks section. Same issue flagged for executive dashboard expandable sections in earlier reviews.

4. **Google Calendar reconnect flow is fragile.** The "+ Add Account" button and error banner depend on `calendarAccounts` state populated by the freebusy API response. If the API request fails entirely (network error), the catch block sets `calendarError` but the reconnect banner shows a generic message with no button (the button is in the error banner, but `calendarAccounts` is empty so the green bar with "+ Add Account" doesn't render either). There's no standalone "Manage connected accounts" UI.

5. **`PageHeader` "Home" button font (13px) is smaller than sidebar nav (15px) and should match the bumped font sizes.** The user specifically asked for 2–3px bigger across the entire app, but this component was missed.

### Top 3 Improvements (Ranked by Value vs Effort)

#### 1. Bump content font sizes app-wide to match sidebar (Quick Win — 30 min)
**Files:** `SharedUI.tsx` (PageHeader, KPICard, table styles), `home/page.tsx`, `pa/page.tsx`
**What:** Increase the `PageHeader` "Home" button from 13px to 15px. In `home/page.tsx`, bump the dominant 11px→13px, 12px→14px, 13px→15px. Apply the same +2px to `KPICard` value/label sizes in `SharedUI.tsx` (currently 21px/14px → 23px/16px). Bump `tableHeaderStyle`/`tableCellStyle` from 15–16px to 17–18px — these feed every table in the app.
**Why:** The user explicitly said fonts are too small and needs 2–3px bigger. The sidebar was fixed but page content wasn't. This is the most impactful single change for readability, and the shared styles in `SharedUI.tsx` cascade to every page that uses table/KPI components.

#### 2. Clean up `PageHeader` — remove dead title/subtitle params (Quick Win — 15 min)
**Files:** `SharedUI.tsx` (definition), 20+ page files (call sites)
**What:** Remove the `title` and `subtitle` parameters from `PageHeader` since they're unused (destructured as `_title`/`_subtitle`). Update all 20+ call sites to just `<PageHeader />` or `<PageHeader hideHome />`. Rename the component to `HomeButton` for clarity.
**Why:** Dead props mislead contributors. Every new page copies the pattern and passes a title that renders nowhere. This is a mechanical find-and-replace, zero risk.

#### 3. Dark mode migration — fifth consecutive flag (Larger Effort — 3-4 hrs)
**Files:** ~20 inner pages (same list as prior reviews)
**What:** Replace all hardcoded `"white"`, `"#f8fafc"`, `"#f1f5f9"`, `COLOURS.NAVY` backgrounds with CSS vars. Start with `SharedUI.tsx` table styles (they cascade to every page), then `executive/page.tsx` (21 whites), `meetings/page.tsx` (20), `MembersManager.tsx` (17).
**Why:** The dark mode toggle works for the shell but breaks every inner page. This has been flagged in every review since 2026-06-26. Recommendation: either do the migration or remove the dark mode toggle — half-working dark mode is a worse experience than no dark mode at all.

### Quick Win for Today

**Bump the `PageHeader` "Home" button from 13px to 15px** and increase its icon from 14×14 to 16×16. In `SharedUI.tsx` line 107, change `fontSize: "13px"` → `fontSize: "15px"`, and line 116, change `width="14" height="14"` → `width="16" height="16"`. Two values, deploy. The most visible small font in the app (it appears on every inner page) immediately matches the sidebar's bumped sizing.

---

## 2026-06-28

### Previous Items Status

From 2026-06-27:
- ✅ **Sidebar right border** — Done (`SidebarLayout.tsx` line 423)
- ✅ **PERM_FUNC duplication** — Resolved. The duplicate in `home/page.tsx` was removed along with `PAHomeView`. Only `SidebarLayout.tsx` retains the canonical copy now — no extraction needed since there's only one consumer.
- 🔲 **Dark mode migration (~20 pages)** — Still outstanding. Executive (21× `"white"`), members (17×), meetings (20×), PA (14×), calendar (13×) all still hardcode colors. The new investments page is *partially* migrated (6× CSS vars, but still has hardcoded `#f8fafc`, `#f1f5f9`, `#991b1b`, and `#fef2f2`).
- 🔲 **Access Matrix accessibility** — Still outstanding. Toggles still lack `aria-label` / `aria-pressed`.
- ✅ **`maximumScale: 1` removed** — Done (previous review)

### Current State Assessment

Big feature landed this session: full PSX Investments portfolio tracker — database schema, daily automated price fetching via Vercel Cron, dedicated 640-line investments page with charts, and executive dashboard integration. The permission model is clean: `canViewInvestments` in `permissions.ts` with override support via Access Matrix, gated to CEO + admin only. The investments page was built with partial CSS var awareness (`var(--bg-card, #fff)` for main cards) but still has hardcoded colors in alerts, table headers, and chart grids.

The cron setup (`vercel.json` → `/api/investments/update-prices`) is well-structured with PSX primary + Yahoo fallback, CRON_SECRET protection, and service role for writes.

### Design Inconsistencies & Issues Found

1. **Investments alert banner uses hardcoded reds.** `investments/page.tsx` line 318-325 uses `backgroundColor: "#fef2f2"`, `color: "#991b1b"` for the stocks-down-5% alert. Every other alert-style element in the app should use CSS vars for dark mode compatibility. Same issue with table header row (`#f8fafc` at line 397) and chart grid lines (`#f1f5f9` at lines 527, 550).

2. **Executive dashboard investment card uses `backgroundColor: "white"`.** `executive/page.tsx` line 977 — the investment summary card hardcodes `"white"` instead of `var(--bg-card)`. This is consistent with the rest of the executive page (which has 21 hardcoded whites) but will break in dark mode.

3. **Price update API fetches sequentially.** `api/investments/update-prices/route.ts` lines 87-103 — each ticker is fetched one at a time in a `for` loop. With 20 tickers × 10s timeout, worst case is 200s. Using `Promise.allSettled` with a concurrency limit (e.g., 5 at a time) would cut this to ~40s and stay within Vercel's 300s function timeout.

4. **No error state on the investments page.** If Supabase queries fail, the page shows empty tables with no feedback. Other pages in the app have similar gaps, but given investments shows financial data, a clear error state matters more here.

### Top 3 Improvements (Ranked by Value vs Effort)

#### 1. Parallelize price fetching in the cron job (Quick Win — 15 min)
**File:** `app/api/investments/update-prices/route.ts` lines 87-103
**What:** Replace the sequential `for` loop with batched `Promise.allSettled` (groups of 5). Each batch runs 5 fetches concurrently, then moves to the next batch.
**Why:** 20 sequential HTTP calls with 10s timeouts risk hitting Vercel's function timeout. Batching by 5 cuts wall time by ~4×. The PSX API has no documented rate limit, and Yahoo Finance handles concurrent requests fine. Simple refactor, big reliability improvement.

#### 2. Add error/empty states to the investments page (Quick Win — 20 min)
**File:** `app/investments/page.tsx`
**What:** Add a visible error banner if Supabase queries fail (currently silently swallowed), and an empty state with "No holdings found — add your first stock" message + CTA when the holdings array is empty.
**Why:** Financial data pages need clear feedback when something goes wrong. Users currently see blank tables with no indication of whether data is loading, empty, or broken.

#### 3. Dark mode migration — still outstanding (Larger Effort — 3-4 hrs)
**Files:** ~20 inner pages (see 2026-06-27 entry for full list), plus the new `investments/page.tsx`
**What:** Replace all hardcoded `"white"`, `"#f8fafc"`, `"#f1f5f9"` etc. with CSS vars (`var(--bg-card)`, `var(--bg-subtle)`, `var(--border-color)`). The investments page is partially done (6 CSS vars already) so it's a good candidate to finish first as a template for the rest.
**Why:** Third consecutive review flagging this. The toggle exists, the shell works, but every page interior breaks. This is the single largest UX debt in the app.

### Quick Win for Today

**Parallelize the price fetcher.** In `route.ts`, replace the `for` loop (lines 87-103) with:
```ts
const BATCH = 5;
for (let i = 0; i < tickers.length; i += BATCH) {
  const batch = tickers.slice(i, i + BATCH);
  const settled = await Promise.allSettled(batch.map(async (ticker) => { ... }));
}
```
15 minutes, deploy. The daily cron becomes 4× faster and much less likely to timeout.

---

## 2026-06-27

### Previous Items Status

All 3 items from 2026-06-26 are **done**:
- ✅ Consolidate duplicated design constants — local NAVY/SLATE/BORDER removed from executive, finance, opening-balances
- ✅ Fix dark-mode CSS — broken `prefers-color-scheme` block removed, proper ThemeProvider with CSS vars added
- ✅ Loading skeletons on Home — shimmer skeleton matching KPI/list layout now renders during load

### Current State Assessment

Major redesign landed: sidebar-based SaaS layout (SidebarLayout.tsx), CSS variable theming (ThemeProvider.tsx), and PulseDesk-style dashboard with KPI cards + Today's Tasks + widgets. The architecture is clean — AuthWrapper handles auth/data, SidebarLayout handles layout, pageRegistry.ts is the nav source of truth, and permissions flow through identically in sidebar and home page.

However, the redesign was applied to the _shell_ (sidebar, header, home page) but the _inner pages_ haven't been migrated to use CSS variables. This means dark mode is broken on ~20 pages — the sidebar and header flip correctly but all page content stays white with hardcoded colors.

### Design Inconsistencies & Issues Found

1. **~20 pages still hardcode colors, breaking dark mode.** The worst offenders: `executive/page.tsx` (20× `"white"`), `members/MembersManager.tsx` (17×), `meetings/page.tsx` (20× hardcoded hex), `pa/page.tsx` (17×), `calendar/page.tsx` (13×). These pages render white cards on a dark background in dark mode — unreadable. The home page was migrated correctly as a reference.

2. **Duplicate h1 titles on 2 pages.** `dashboard/page.tsx` (line 13) and `production/page.tsx` (line 13) render their own `<h1>` and inline back button, duplicating the title and back functionality already provided by SidebarLayout's sticky header. Users see "Operations Dashboard" twice.

3. **Sidebar has no right border.** `SidebarLayout.tsx` `<aside>` (line 414) has no `borderRight`. With the white sidebar on the `#f4f6f9` page background, the boundary is barely visible — especially on lower-contrast monitors. PulseDesk (the inspiration) uses a 1px border.

4. **PERM_FUNC + isCardVisible duplicated across two files.** `home/page.tsx` lines 25-73 and `SidebarLayout.tsx` lines 25-73 are byte-for-byte identical — 50 lines of permission logic copy-pasted. If a new permission is added to one but not the other, nav visibility will silently diverge from the home page cards.

5. **SharedUI table styles not theme-aware.** `tableHeaderStyle`, `tableCellStyle`, `tableCellBoldStyle` (SharedUI.tsx lines 254-273) use `COLOURS.BORDER`, `COLOURS.SLATE`, `COLOURS.NAVY` and a hardcoded `#f1f5f9` — not CSS vars. Every page using these (executive, finance, receivables, etc.) will have broken table colors in dark mode.

6. **Accessibility — still outstanding from last review:**
   - Access Matrix toggles still lack `aria-label` / `aria-pressed` (AccessMatrix.tsx ~line 369)
   - Executive dashboard expandable sections still use `onClick` on `<div>` without `role="button"` or keyboard support

### Top 3 Improvements (Ranked by Value vs Effort)

#### 1. Add sidebar right border (Quick Win — 5 min)
**File:** `SidebarLayout.tsx` line 414, the `<aside>` style
**What:** Add `borderRight: "1px solid var(--sidebar-border)"` to the desktop sidebar `<aside>`. This gives the clean visual separation that PulseDesk uses.
**Why:** Without it, sidebar and content bleed together on many monitors. 1 line, instant visual improvement.

#### 2. Extract shared permission logic (Quick Win — 20 min)
**Files:** `home/page.tsx`, `SidebarLayout.tsx`
**What:** Move `PERM_FUNC` and `isCardVisible()` into a shared module (e.g., add them to `permissions.ts` or create `lib/permissionCheck.ts`). Import from both files. Eliminates 50 lines of duplication.
**Why:** These are the core permission-to-visibility functions for the entire app. Right now a change in one file can silently break the other. Zero risk refactor.

#### 3. Migrate inner pages to CSS variables for dark mode (Larger Effort — 3-4 hrs)
**Files:** All ~20 pages listed above, especially `executive/page.tsx`, `members/MembersManager.tsx`, `meetings/page.tsx`, `pa/page.tsx`, `calendar/page.tsx`
**What:** Replace hardcoded `backgroundColor: "white"` with `var(--bg-card)`, `color: COLOURS.NAVY` with `var(--text-primary)`, `border: "1px solid #e2e8f0"` with `var(--border-color)`, etc. Also migrate `SharedUI.tsx` table styles to use CSS vars.
**Why:** Dark mode toggle exists and works for the shell, but toggling it makes every page interior unreadable. Either finish the migration or remove the toggle. Half-working dark mode is worse than none.

### Quick Win for Today

**Add the sidebar border.** In `SidebarLayout.tsx` line 414, add `borderRight: "1px solid var(--sidebar-border)"` to the `<aside>` style object. One line, deploy. The sidebar immediately gets the clean visual separation seen in PulseDesk and every modern SaaS sidebar.

---

## 2026-06-26

### Current State Assessment

The app is a well-structured internal operations dashboard with consistent visual language: navy/slate colour tokens via `SharedUI.tsx`, uniform card patterns, and responsive breakpoints via `useMobile()`. The recent permissions/access-matrix work is solid. However, there are some design inconsistencies and areas where UX can be tightened.

### Design Inconsistencies & Issues Found

1. **Duplicate colour/style constants across files.** `executive/page.tsx` (lines 160-162) redeclares `NAVY`, `SLATE`, `BORDER` locally instead of importing from `SharedUI.tsx`. Same in `opening-balances/OpeningBalancesForm.tsx` (lines 10-12) which also redeclares a local `SectionTitle` component identical to the shared one. `FinanceManager.tsx` (lines 51-56) does the same. This creates drift risk — if the design tokens change, these files won't update.

2. **Dark mode mismatch.** `globals.css` declares `prefers-color-scheme: dark` CSS variables (lines 15-20), but every component uses hardcoded light-mode inline styles. In dark mode, the CSS background flips to `#0a0a0a` but all cards/panels remain white — broken contrast. Either remove the dark-mode CSS vars or add proper dark-mode support.

3. **Login page uses different colour constants than the rest of the app.** `login/page.tsx` defines its own `titleStyle` with `#1f2a44` (line 267) rather than the shared `COLOURS.NAVY` (`#1e293b`). The primary button is `#2563eb` (line 310) while the rest of the app uses `COLOURS.NAVY` for primary buttons (`SharedUI.tsx` line 308). Small but noticeable brand inconsistency.

4. **Accessibility gaps:**
   - The Access Matrix toggle buttons (`AccessMatrix.tsx` lines 369-396) lack `aria-label` or `aria-pressed` attributes — screen readers can't distinguish them.
   - The "Back" button in `PageHeader` (`SharedUI.tsx` line 105) has no `aria-label`.
   - The executive dashboard's expandable sections use `onClick` on `<div>` elements without `role="button"` or keyboard support (`executive/page.tsx` lines 1017-1018).

5. **`maximumScale: 1` in viewport** (`layout.tsx` line 25) prevents pinch-to-zoom, which is an accessibility violation (WCAG 1.4.4). Users with low vision are blocked from zooming.

### Top 3 Improvements (Ranked by Value vs Effort)

#### 1. Consolidate duplicated design constants (Quick Win — 30 min)
**Files:** `executive/page.tsx`, `opening-balances/OpeningBalancesForm.tsx`, `finance/FinanceManager.tsx`
**What:** Replace all local `NAVY`/`SLATE`/`BORDER` consts and the duplicated `SectionTitle` with imports from `SharedUI.tsx`. This removes ~40 lines of redundant code and ensures design token changes propagate everywhere.
**Why:** Right now a colour change in `SharedUI.tsx` leaves three pages on stale values. Zero risk, pure cleanup.

#### 2. Fix dark-mode CSS causing broken contrast (Quick Win — 10 min)
**File:** `globals.css` lines 15-20
**What:** Remove the `@media (prefers-color-scheme: dark)` block entirely. The app has no dark-mode support — every component renders with white backgrounds and dark text via inline styles. The CSS dark vars only cause a flash of dark background before components mount, or broken contrast for users whose OS is set to dark mode.
**Why:** Users on dark-mode devices see a jarring flash or partially-dark UI. Removing 5 lines fixes it.

#### 3. Add loading skeletons to the Home dashboard (Larger Effort — 2-3 hrs)
**File:** `home/page.tsx` line 166
**What:** Replace the plain "Loading..." text with skeleton card placeholders that match the grid layout (grey pulsing rectangles in the same card shape). The home page loads badges from 9 parallel Supabase queries — on slow connections, users stare at a blank page with one line of grey text.
**Why:** This is the first thing every user sees after login. A skeleton makes the app feel instant and professional. Moderate effort because you need to render placeholder cards in the same grid structure.

### Quick Win for Today

**Remove the dark-mode CSS block** from `globals.css` (lines 15-20). Delete 5 lines, deploy. Users on dark-mode devices immediately get a consistent light-mode experience instead of broken contrast. Under 5 minutes.
