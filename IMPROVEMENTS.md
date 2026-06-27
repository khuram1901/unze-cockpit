# Improvements Log

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
