# Unze Dashboard — Full App Audit
**Date:** 15 July 2026
**Method:** Full read-only pass — `tsc`/`eslint` across the whole app, a Supabase security + performance advisor run against the live database, a CLAUDE.md-compliance grep sweep, and seven parallel code reviews covering every page, every API route, and the shared `lib/` foundation. Nothing was changed — this is findings only.

No fixes have been made yet. Everything below is grouped by severity so you can decide what to tackle first.

---

## How to read this

- **Critical** — wrong data, a broken permission, a security hole, or something a user could lose.
- **High** — a real bug that will misbehave under normal use.
- **Medium** — breaks one of your own house rules (JS aggregation, `select("*")`, hardcoded colours) or is dead/duplicated code. Not actively broken today, but a risk.
- **Low** — cosmetic, cleanup, or "worth knowing" with no user impact.

---

## CRITICAL

### Data correctness

1. **Opening Balances form silently zeroes out the 40ft stock quantity every time it's saved.** `app/opening-balances/OpeningBalancesForm.tsx` — the form only fetches four of the five quantity columns (`qty_31, qty_36, qty_45, qty_meter` — missing `qty_40`), so the 40ft field always shows blank on load even if a real value is saved. Worse, the save logic drops any row where only the 40ft value is non-zero, and for rows that do save, it writes `qty_40: 0` by default. Net effect: any previously entered 40ft figure gets wiped the next time someone saves this form.

2. **Tax notices and HR recruitment are hardcoded to UTPL regardless of which company you pick.** `app/department/[slug]/TaxationDashboard.tsx` has a company dropdown (UTPL, IFPL, Haute Dolci, Barahn, K&K Jhang, Directors) but the actual database insert always writes `company_id: UTPL_COMPANY_ID` — every non-UTPL tax notice is mislabelled as UTPL. `app/department/[slug]/HRDashboard.tsx` does the same for recruitment positions, with no company picker at all — IFPL recruitment can't even be logged.

3. **Dispatch's dual-write has no rollback.** `app/production/ProductionForm.tsx` — the legacy `dispatch_entries` write commits first, then a second call writes `dispatch_records` (the stock system). If the second call fails, the user sees an error but the first write has already stuck — the two systems are now silently out of sync with no retry.

4. **A task can be created already "Completed," skipping HOD review entirely.** `app/tasks/NewTaskForm.tsx` offers "Completed" as a starting status, and `createTaskCore` inserts whatever status is given with no check. All the safety nets we built this session (migrations 114/115/117) are `BEFORE UPDATE` triggers — they don't fire on `INSERT`. Anyone with task-creation rights can hand themselves a pre-closed task.

5. **The little inline subtask checklist on task rows ignores the Completed-task lock.** `app/tasks/MiniSubtaskToggle.tsx` has no lock check at all, and the migration 117 database trigger only protects the `tasks` table, not `task_subtasks` — so subtasks on a Completed task can still be ticked/added through this control, by anyone, with no backstop. This is a real gap in the lock feature we shipped earlier today.

6. **A Submitted task can get routed to an offboarded manager and vanish.** `app/lib/taskRouting.ts` and its DB-trigger twin (migration 116) reassign a Submitted task to `manager_id` without checking `members.is_active`. Since inactive members are filtered out of every picker in the app, a task routed to a leaver becomes invisible and effectively stuck forever, with no fallback layer catching it.

7. **Your CEO dashboard's task feed is capped at 200 rows, ordered by newest-created** — `app/home/page.tsx`. Every escalation calculation on the exception dashboard (overdue, waiting-reply, department scorecards) runs off this capped fetch. If the tasks table ever exceeds 200 rows, the oldest and most neglected tasks — exactly the ones a "management by exception" dashboard exists to surface — are the ones that silently disappear.

### Security

8. **Any logged-in user can set any other account's password, including yours.** `app/api/auth/set-password/route.ts` checks only that *someone* is logged in — there's no check that the caller is allowed to change *that specific* account's password. The permission check (`canChangePasswordFor`) only exists in the UI, not on the server.

9. **Any logged-in user can invite new accounts with any role, including Admin.** `app/api/members/invite/route.ts` has the same gap — no server-side `canAddMembers()` check, and the role is taken straight from the request body.

10. **The full-database wipe route is a live, reachable endpoint protected only by the same secret your routine cron jobs use.** `app/api/admin/wipe-data/route.ts` deletes rows from ~30 production tables, gated by `Bearer CRON_SECRET` — the identical secret used by ~15 unrelated daily/weekly cron routes. If that one secret ever leaks (logged, shared, committed), this is reachable.

11. **The app's shared Google integration (Gmail/Calendar/Drive) can be hijacked by a stranger.** `app/api/google/auth` and `app/api/google/callback` have no authentication at all. Anyone can complete their own Google consent screen against these routes; the callback saves the resulting token with no email check, and the code that later uses this integration (`getAuthenticatedClient()`) just grabs the *most recently saved* token with no filter — so a stranger's token silently becomes the credentials the whole app uses, until you notice and reconnect.

12. **Roughly 20 tables — including `tasks`, `pension_contributions`, `pension_funds`, `tax_return_filings`, `tax_schedule_entries`, `meetings`, `machine_issues`, `department_budgets` — have database-level write policies that are unconditionally "allow everyone logged in."** Confirmed directly against the live database. This means the actual permission rules (who can edit what, PA vs Admin, company separation) exist only in the app's screens and API routes — anyone with a valid login and a little technical curiosity could write to these tables directly, bypassing every role check the app enforces. Reads weren't checked here (this run was about write policies), but this is worth a dedicated look given how sensitive the pension/tax data is.

13. **PA (Executive role) can view — and refresh — investment data.** `app/lib/permissions.ts` — `canViewInvestments()` and `canRefreshInvestmentPrices()` both explicitly return `true` for PA. A code comment cites a verbal approval from you on 12 July 2026, so this may be a deliberate, known exception — but it sits in direct conflict with the written rule ("PA never sees financial data. Ever."), so it's flagged here so you can confirm it's still what you want, in writing.

---

## HIGH

- **Cash "closing after post-dated cheques" is computed differently for UTPL vs IFPL, in two different files, in JS.** `app/finance/FinanceManager.tsx` recomputes this only for Imperial; UTPL is trusted as-is from the database. If the stored value and the formula ever drift, the headline "Net Position" card and the daily table can disagree.
- **Department budget totals, Monthly Operations Targets, and Receivables aging are all summed in JavaScript** instead of the database, in violation of your own rule 0 — duplicated across `FinanceManager.tsx`, `app/finance/page.tsx`, `app/monthly-operations-targets/page.tsx`, and `app/receivables/page.tsx`.
- **Scrap entries have no duplicate-submission guard** — unlike production/dispatch/breakage, `ProductionForm.tsx` lets the same plant/day be submitted twice, silently double-counting scrap.
- **Letter-expiry checks use UTC "today," not Pakistan local time** (`ProductionForm.tsx`, `app/stock/page.tsx`) — for roughly 5 hours after local midnight, a letter that's technically expired locally still shows as valid.
- **The "Reassign to" dropdown inside the task detail view doesn't update the multi-assignee list.** `TaskStatus.tsx`'s reassign control (and the same pattern in `app/pa/page.tsx`) only updates the single `assigned_to` field, not `task_assignees` — so using it desyncs co-assignee data (stale people keep seeing the task, "+N" chips go wrong). The Owner(s) editor elsewhere in the same screen does this correctly, which makes the inconsistency easy to trigger by accident.
- **`TasksPageClient.tsx` passes `canDeleteTask(ctx, null)`, which is always `true` for any logged-in user** regardless of role, because the "is this task protected" check short-circuits on a `null` task. The Delete button itself is still safely gated elsewhere, but this makes the WhatsApp reminder button visible to everyone on every task, including tasks assigned by someone else.
- **Two live, diverging copies of Recurring Tasks exist** — the old standalone page (`app/recurring-tasks/page.tsx`, no longer in the sidebar but still reachable by URL) has no company field and no per-template edit; the merged panel version has both. Same table, two different feature sets depending which URL is used.
- **Password login doesn't check that a `members` row exists**, unlike Google sign-in (which explicitly rejects and signs out any account with no matching member). A stale or deleted member record can still log in via password and land on `/home` with default permissions.
- **The audit log page fetches up to 500 raw rows and aggregates counts in JavaScript** instead of an RPC — same rule-0 violation as the finance pages, on a page whose entire job is to show accurate counts.
- **Three legacy report emails (`daily-pdf`, `weekly`, `monthly-po`) were never migrated to the RPC pattern** used by the newer CEO daily digest — they fetch unbounded datasets and aggregate in nested loops, and appear to duplicate content the digest already sends.
- **WhatsApp messages to contractors and staff use raw, unformatted dates** — `app/lib/whatsapp.ts` interpolates `due_date`/`dispatch_date` directly without `formatDateUK()`, so people receive dates in the wrong format over WhatsApp, in violation of the DD/MM/YYYY rule.
- **An encryption key environment variable name mismatch.** `app/lib/crypto.ts` reads `TOKEN_ENCRYPTION_KEY`, but your documentation lists `ENCRYPTION_KEY` as the variable that's actually set in Vercel. If that's correct, Google OAuth tokens may currently be encrypted with a fallback key instead of a dedicated one — worth confirming which variable is actually set.
- **The CEO dashboard and the plant Ops dashboard implement the same achievement-threshold and breakage-band rules independently**, in two files (`home/page.tsx`, `DashboardView.tsx`) — a plant could show green on one screen and amber on the other if the two copies ever drift.
- **`canViewFinance()` in `lib/permissions.ts` checks a per-member override before checking "is this PA,"** so a mis-set Access Matrix override could theoretically let a PA account see finance data through this shared helper. Not currently exploitable on the home page itself (which has its own separate, correct PA redirect), but the helper is reused elsewhere and should be fixed at the source.
- **`/api/investments/dividends` (GET)** has no role check at all — any logged-in user, not just PA/Finance, can read dividend figures.

---

## MEDIUM (rule violations, dead code, duplication)

- **`select("*")` is used in 62 places** across the app instead of naming the columns actually used — receivables, finance, home, stock, monthly targets, meetings, my-minutes, audit log, and about a dozen API routes. Most are low-risk (small tables, most columns genuinely used), but it's a repeated, easy-to-fix rule violation worth a cleanup pass.
- **Hardcoded hex colours outside `SharedUI.tsx`** appear in 46 files. Most just re-type existing `COLOURS` values as literals (e.g. `#64748b` typed directly 44 times instead of importing `COLOURS.SLATE`) rather than introducing new ones — but a genuinely separate "dark theme" palette (`#0D1117`, `#6E45B8`, `#9ED4A3`, `#F6D28A`, and others, centred on `ThemeProvider.tsx`) is scattered across 11 files instead of centralised, so changing the dark theme means editing 11 places by hand.
- **`CLAUDE.md`'s own documented colour palette is stale** — the real, live palette in `SharedUI.tsx` matches `BLUEPRINT.md`, not the values written in `CLAUDE.md`. This already caused one real mockup-mismatch mix-up this session and should be corrected so it doesn't happen again.
- **The forgot-password and reset-password pages still say "PulseDesk"** and use raw hex colours — they were missed when the rest of the app was restyled.
- **`lib/MyTasks.tsx` has an unreachable code branch** — an early `return null` guarantees a later conditional block can never run. Harmless today, misleading for the next person who edits it.
- **`lib/department-config.ts` and `lib/AuthWrapper.tsx`** both compute counts/totals in JS from fetched rows (department KPIs, notification-bell badge counts) — small datasets today, but the same rule-0 pattern repeated in shared, widely-reused code.
- **Two independent, hand-rolled auth-check implementations** exist alongside the shared `requireAuth()` helper (`/api/me/permissions`, `/api/investments/update-prices`) — functionally fine today, but a future fix to the shared helper won't reach these.
- **Several `useEffect(() => { loadData() }, [])` patterns trigger a "setState in effect" lint error** — this is a systemic pattern across dozens of files (34 instances total), not a one-off bug. It's the standard "load on mount" idiom and isn't causing visible problems anywhere checked, but it's worth knowing this is why `eslint` currently reports 64 errors app-wide.
- **A handful of components are recreated on every render** (`ProductionForm.tsx`'s `SectionMessage`/`ReasonSelect`, similar spots in `TaxComplianceSummary.tsx` and `AuditDashboard.tsx`) — confirmed low-impact (no internal state to lose), but can occasionally drop focus on a dropdown mid-interaction.
- **Roughly 20 RPC functions added since the last anon-execution review** (task routing/lock triggers, the CEO digest, the ops snapshots, pension/portfolio/folderit summaries) show up as callable by the `anon` and `authenticated` Postgres roles at the grants level, same as everything else in the database. You reviewed this pattern once already (task #49) and presumably accepted it as safe given the internal role checks inside each function — flagging only because it's grown since that review and is worth one more look now that the write-policy gap above (#12) is on the table too.

---

## LOW

- 66 unused variables/imports flagged by ESLint across the app (dead code, safe to remove — e.g. `CountCard` and `OPS_HOD_EMAIL` in `app/receivables/page.tsx`).
- `app/my-dashboard/page.tsx` is a 10-line redirect to `/home` — it works, but `BLUEPRINT.md` still describes it as a separate personal-summary page; that functionality has moved into `/home`'s My Tasks widget.
- A company-name string mismatch in `TaxationDashboard.tsx` (`"Imperial Footwear Pvt Limited"` vs `"...PVT Limited"`) means IFPL always shows grey instead of its proper colour on the tax notices donut chart — a display bug, not a data bug.
- `app/recurring-tasks/page.tsx` still has emoji icons that were deliberately removed from the merged version — another sign this page is an unmaintained leftover (see High, above).
- Database performance notes from the live advisor: ~20 foreign keys without a covering index (e.g. `tasks.company_id`, `tasks.meeting_id`, `guarantees.linked_guarantee_id`) and a handful of indexes that have never been used — routine housekeeping, not urgent.

---

## What's already fine

A lot of the app held up well under this review, worth naming so it doesn't get lost among the findings above:

- Company separation (UTPL/IFPL) is correctly respected on the CEO dashboard, accounts-tax dashboards, and most finance surfaces — the issues found above are contained to a few specific pages (tax notices, HR recruitment), not systemic.
- The PA/Executive financial exclusion is correctly enforced almost everywhere it matters — accounts-tax, guarantees, finance pages, the home dashboard's finance section. Investments is the one confirmed exception, and it's flagged above.
- `lib/permissions.ts`'s core logic is internally consistent (`isPrivileged` genuinely always includes everyone `isAdminTier` includes; `canReopenCompletedTask` matches its database trigger).
- `lib/pageRegistry.ts` and `SidebarLayout.tsx`'s `PERM_FUNC` are in sync — no drift found.
- `formatDateUK()` and the date-input components are used correctly almost everywhere; no `<input type="date">` violations were found anywhere in the app.
- The single shared task-creation route (`/api/tasks/create`) is genuinely the only path that inserts tasks — no other route or page bypasses it.
- Today's task detail modal redesign (two-column layout, card-grouped status, owner chips) was checked carefully given how fresh it is — no broken props, no leftover dead code from the old layout, and the Submitted-routing/Completed-lock logic in `TasksList.tsx`/`TasksBoard.tsx` is internally consistent (the reassign-dropdown bug above is a separate, older issue, not something introduced today).

---

## Suggested next step

This is a lot — 13 critical items, ~18 high, and a long tail of medium/low cleanup. Rather than tackling all of it at once, it's worth picking a starting point together. A reasonable order, roughly by risk:

1. The four security gaps (set-password, invite, wipe-data, Google OAuth) — these are the ones a person could exploit today, not just a bug someone might hit by accident.
2. The RLS write-policy gap (#12) — this is the one structural fix that would close off a lot of the "bypass the app and hit the database directly" risk at once.
3. The two real data-loss bugs (Opening Balances 40ft, tax notices/HR company mislabelling).
4. Everything else, in whatever order matters most to you.

No changes have been made — say which of these you want to start on and I'll work through it one at a time, the same way we've been doing the rest of this project.
