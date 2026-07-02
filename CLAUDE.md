# Working with Khuram — Unze Dashboard Project

**Read this file at the start of every session.** It captures who I am, how I work, and how to help me best.

**At the start of every session, also read the top 2-3 entries in `sessions/summaries/INDEX.md` to understand what was worked on most recently.**

---

## About me

- **Name:** Khuram Saleem
- **Role:** CEO, Unze Group
- **Coding experience:** First-time developer. I'm passionate, patient, and want to learn — but I need things explained in plain language, not jargon.
- **How I work best:**
  - Explain in simple terms; check I understand before moving on
  - Give me options with clear trade-offs instead of picking silently
  - Push back honestly if you think I'm wrong — don't just say yes
  - Confirm before big changes (deletions, database migrations, cost decisions)
  - Small, focused commits I can understand — not massive changes at once

---

## The project

**Unze Group Dashboard** — a CEO operating system for Unze Group (production, finance, stock, tasks, meetings).

Project path: `/Users/jamesbond/Documents/App/Unze Dashboard`

Full context lives in:
- `BLUEPRINT.md` — complete current state of the app (READ THIS before coding anything)
- `CHANGELOG.md` — timeline of every change
- `sessions/summaries/INDEX.md` — most recent session summaries (read top 2-3)
- Memory files at `~/.claude/projects/-Users-jamesbond-Documents-App-Unze-Dashboard/memory/`

**Read BLUEPRINT.md at the start of any session that touches the app.** That is the source of truth.

---

## Non-negotiable rules

1. **All displayed dates: DD/MM/YYYY — no exceptions.**
   - In `.tsx` files: always `formatDateUK(dateString)` from `lib/dateUtils.ts`. Never render a raw `YYYY-MM-DD` string from the database directly in JSX.
   - In API routes / email HTML (where imports aren't available): use `d.split("-").reverse().join("/")`.
   - Never use `new Date().toLocaleDateString()` without the `"en-GB"` locale.
   - Never write a local copy of this logic — always import from `lib/dateUtils.ts`.
   - When adding any new feature that shows a date: ask "did I wrap this in formatDateUK?" before finishing.
   - `app/layout.tsx` has `lang="en-GB"` on the root `<html>` — this forces all `<input type="date">` pickers to show DD/MM/YYYY in the browser. **Never change this back to `lang="en"`.**
2. **Design system in `lib/SharedUI.tsx` only.** Colours: NAVY `#1e293b`, SLATE `#64748b`, BORDER `#e2e8f0`, GREEN `#16a34a`, AMBER `#d97706`, RED `#dc2626`. Never introduce new colours without asking.
3. **Inline styles, not Tailwind classes.** The codebase is intentionally inline-styled.
4. **British English** in user-facing copy ("colours" not "colors").
5. **No sensitive data in code.** Supabase keys, API keys, tokens live in Vercel/env vars only.
6. **PA (Executive role) never sees financial data.** Ever. Not on any page.
7. **Multi-company aware.** UTPL and IFPL are separate companies with separate cash/budgets. Never mix their data.
8. **Management by exception.** Dashboards show status and exceptions, not raw data dumps.
9. **Migrations are applied MANUALLY.** Write `.sql` files to `supabase/` but NEVER auto-run them. Tell Khuram to apply via Supabase SQL Editor.
10. **Dual-write for dispatch.** Production dispatch writes to BOTH `dispatch_entries` (legacy ops dashboard) AND `dispatch_records` (stock system). Never remove either write.
11. **Read `node_modules/next/dist/docs/` before using any Next.js API** — this version has breaking changes.

---

## Stack

- **Framework:** Next.js App Router (custom version — see AGENTS.md)
- **Database:** Supabase (PostgreSQL) with Row Level Security
- **Auth:** Supabase Auth
- **Deployment:** Vercel
- **Styling:** Inline styles only (no Tailwind, no CSS modules)
- **Language:** TypeScript

---

## Key architecture patterns

- `useRequireCapability(cap)` — route guard hook, gate every page
- `authedFetch()` — always use for client API calls (adds Bearer token)
- `requireAuth(request)` in API routes — always call this first
- `createServiceClient()` for DB writes in API routes (bypasses RLS)
- `useToast()` returns `{ show, element }` — NOT `{ toast, element }`
- `PAGE_REGISTRY` in `app/lib/pageRegistry.ts` — single source for sidebar cards
- `PERM_FUNC` in `SidebarLayout.tsx` — must stay in sync with pageRegistry permKeys

---

## People in the business

- **Khuram (me):** Admin role, CEO — sees everything
- **Nadeem.Khan, Asif, Usman:** Operations team — see production/stock/dispatch pages
- **PA:** Executive role — no financial access, acts on CEO's behalf for tasks/calendar
- **Finance Manager:** Manager role — Finance tab only (special exception)
- **Operations Manager:** Manager + Unze Trading Ops dept — can manage POs/letters

---

## Preferences

- **Model:** Sonnet by default. Switch to Opus only for genuinely hard problems.
- **Between unrelated tasks:** Suggest `/clear` to reset context.
- **When finishing a feature:** Update memory files or invoke `blueprint-keeper` agent.
- **Commits:** Small, descriptive messages. Push after each meaningful change.
- **Terminal commands:** Show what they do before running.

---

## Costs to protect

Stack costs approximately £50/month. Do not add paid services without checking first. Free alternatives always preferred.

---

## When something doesn't make sense

- If my request contradicts the blueprint, tell me and ask.
- If you find something in the code that shouldn't be there, tell me before removing.
- If you're about to burn a lot of budget on something risky, tell me first.

---

## Signing off a session

When we finish:
1. Commit and push any pending changes
2. Update `BLUEPRINT.md` if the code changed materially (or invoke `blueprint-keeper`)
3. Add a summary to `CHANGELOG.md`
4. The session-end hook will auto-save the transcript and summary to `sessions/`

Thanks for working with me on this.
