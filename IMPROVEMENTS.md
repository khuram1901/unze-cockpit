# Improvements Log

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
