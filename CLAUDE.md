## Project AI Workflow

Use Graphify first for codebase understanding.

If `graphify-out/graph.json` exists, query the graph before searching or opening source files for questions about:
- architecture
- modules
- data flow
- dependencies
- implementation details
- where something lives
- what calls what
- how a feature works

Use the project skills automatically:
- `graphify` for codebase mapping and graph queries
- `feature-planner` before new features
- `debugging` for errors and regressions
- `database-safety` for database/schema/permissions/data work
- `security-review` for auth/admin/user-data/secrets/integrations
- `refactor-safety` for refactors
- `code-review` before finalizing code changes
- `docs-sync` after meaningful changes

Prefer small, safe changes. Explain what changed, why, and what I should test.

---

## Project AI Workflow

Use Graphify first for codebase understanding.

If `graphify-out/graph.json` exists, query the graph before searching or opening source files for questions about:
- architecture
- modules
- data flow
- dependencies
- implementation details
- where something lives
- what calls what
- how a feature works

Use the project skills automatically:
- `graphify` for codebase mapping and graph queries
- `feature-planner` before new features
- `debugging` for errors and regressions
- `database-safety` for database/schema/permissions/data work
- `security-review` for auth/admin/user-data/secrets/integrations
- `refactor-safety` for refactors
- `code-review` before finalizing code changes
- `docs-sync` after meaningful changes

Prefer small, safe changes. Explain what changed, why, and what I should test.

---

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

0. **App speed is the top priority. All aggregation and calculation must happen in the database, never in JavaScript.**
   - Every time you write an API route: ask "is this doing a loop, reduce, filter, or sum in JS?" If yes, move it into a Postgres function (RPC) instead.
   - Use `supabase.rpc("function_name", { args })` to call RPCs. Write the function in a numbered `.sql` file in `supabase/` and tell Khuram to apply it manually.
   - RPCs must always have `security definer` and `set search_path = public` for safety.
   - The pattern: one round-trip to the database returns a fully assembled result. The API route is a thin wrapper — auth check, RPC call, return JSON. Nothing more.
   - Never fetch rows and then aggregate them in a `for` loop, `.reduce()`, `.map()`, or `.filter()` in the API route or the page. That is the problem we fixed.
   - Fetching only the columns you need (`select("id, name, status")` not `select("*")`) is mandatory. `select("*")` is only acceptable when you genuinely need every column.
   - Parallel queries (`Promise.all`) are fine where truly independent, but prefer a single RPC that returns everything in one shot.
   - When reviewing existing routes: if you spot JS aggregation, flag it and propose an RPC replacement.

1. **All displayed dates: DD/MM/YYYY — no exceptions.**
   - In `.tsx` files: always `formatDateUK(dateString)` from `lib/dateUtils.ts`. Never render a raw `YYYY-MM-DD` string from the database directly in JSX.
   - In API routes / email HTML (where imports aren't available): use `d.split("-").reverse().join("/")`.
   - Never use `new Date().toLocaleDateString()` without the `"en-GB"` locale.
   - Never write a local copy of this logic — always import from `lib/dateUtils.ts`.
   - When adding any new feature that shows a date: ask "did I wrap this in formatDateUK?" before finishing.
   - `app/layout.tsx` has `lang="en-GB"` on the root `<html>`. **Never change this back to `lang="en"`.**
   - **Never use `<input type="date">` anywhere in the codebase.** Safari ignores `lang="en-GB"` for native date pickers and always shows MM/DD/YYYY. Instead, always use `<DateInput>` from `app/lib/DateInput.tsx`. It shows DD/MM/YYYY, auto-inserts slashes, validates the entry, and calls `onChange` with a `YYYY-MM-DD` string — identical interface to a native date input.
2. **Design system in `lib/SharedUI.tsx` only.** Colours (post-rebrand, corrected 15/07/2026 — this list had gone stale and didn't match the live palette): NAVY `#0F1720`, SLATE `#64748B`, BORDER `#EEF0F3`, GREEN `#0F7B5F`, AMBER `#B4791F`, RED `#B3261E`. Never introduce new colours without asking.
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

## Retail Sales project

**At the start of every session on the Retail Sales feature, read `docs/retail-sales/DECISIONS.md` before touching any code — read the SESSION HANDOVER section first, then the rest of the document.**

This file records every approved decision: store mapping, formulas, access rules, widget keys, migration status, and open items. It is the single source of truth for this feature.

### Permanent rules (non-negotiable)
- NEVER insert into or update `auth.users` with SQL. Use `supabase.auth.admin.createUser` / `updateUserById` only.
- Never push to main or deploy without owner approval. Always record the rollback ID.
- Never create logins or widget override rows without approval. Tests run only inside `BEGIN … ROLLBACK`.
- Never commit `package-lock.json` or `public/sw.js`. Never write passwords anywhere.
- All calculations live in Supabase (generated columns + the `daily_sales_computed` view). The app only displays them.
- Formulas: Total CC = Allied + HBL. Total Sale = Cash + Total CC + Gift Karte + Gift Vouchers − Credit Notes. Closing = Previous Closing + Cash + Campaign Float + Other Income − Expenses − Deposit. A missing opening balance shows blank, never 0.
- Each store email sees only its own store (enforced in DB, server derives store). Store users can reach `/daily-sales` only.
- `/finance/imperial` access = existing finance access OR `has_widget('imperial.retail_sales')`. Other companies' finance pages are unchanged.
- 7-day backdating for stores, no future dates. Month locks 23:59 PKT on day 10 of the following month. HOD (`imperial.retail_sales_hod`) soft-deletes with a reason and reopens months. Everything is audited.
- Attachments compressed (WebP, under 300 KB target, 1 MB limit).
- Verify against git and the live DB before claiming anything is done. Print files with `git show <hash>:path`.

---

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Claude Web Context Rule

In Claude web, if the local folder is not connected, use the uploaded Project Context files first and do not claim to have read source files directly. Ask me to provide files or switch to Claude Code only when exact source edits are needed.

## Claude Web Context Rule

In Claude web, if the local folder is not connected, use the uploaded Project Context files first and do not claim to have read source files directly. Ask me to provide files or switch to Claude Code only when exact source edits are needed.

---

## Test users and post-deploy testing

Three permanent test accounts exist for verifying every feature change before and after deploy.

| Email | Role | Purpose |
|---|---|---|
| test.member@unze.co.uk | Member | No widgets — verifies blocked access / redirects |
| test.manager@unze.co.uk | Manager | Verifies conditional widget access (grant/revoke) |
| test.ceo@unze.co.uk | Admin | Full CEO access — verifies the happy path |

**Rules (non-negotiable):**
- `app_metadata.test_user = true` on all three — never remove this flag
- `notify_email: false`, `notify_whatsapp: false` — notifications are permanently disabled
- These accounts must NEVER appear in headcounts, KPIs, dashboards, Visitors host list, payroll, HR list, or any report
- Never change toggles for real users during testing — only test.member and test.manager get widget overrides
- Always reset overrides after every test run: `node scripts/create-test-users.mjs reset`
- Never edit or import real business data (P&L, retail sales, opening balances, visitors) during tests
- Password lives in Vercel env var `TEST_USER_PASSWORD` (Production + Preview) — never print it anywhere
- Local password file `.test-user-pw` is gitignored — delete it after pasting into Vercel

**Script commands (run from project root):**
```bash
node scripts/create-test-users.mjs create               # create / re-create all 3 accounts
node scripts/create-test-users.mjs reset                # clear all test widget overrides
node scripts/create-test-users.mjs grant <widget> <email>   # enable a widget for testing
node scripts/create-test-users.mjs revoke <widget> <email>  # disable a widget
node scripts/create-test-users.mjs cleanup              # delete test-created data
node scripts/create-test-users.mjs status               # show current state of all 3 accounts
```

**Post-deploy test workflow (run after every feature push):**
1. Test on Vercel preview URL first; then on pulse.unze.co.uk after production deploy
2. Log in as all three accounts:
   - **CEO:** Feature works end-to-end
   - **Manager (toggle ON):** `grant <widget> test.manager@unze.co.uk` → feature visible
   - **Manager (toggle OFF):** `revoke <widget> test.manager@unze.co.uk` → blocked / 403
   - **Member:** No toggle — feature hidden / redirects / APIs return 403
3. Smoke-test: /home, /finance/imperial, /finance/imperial-pnl, Admin Operations (all tabs), /members, plus any changed pages
4. Clean up: `node scripts/create-test-users.mjs reset` → verify overrides = 0
5. Report: pass/fail table per account + screenshots of any failures
6. If production breaks: promote rollback immediately, log rollback commit ID in CHANGELOG.md

---

## HOW WE WORK (mandatory for every chat)

### WHO YOU ARE WORKING FOR
Khuram is the CEO, not a developer. Keep reports short and in plain English. Don't ask technical questions you can answer by reading the code or the database. Don't ask Khuram to commit, push, deploy, run SQL or open Supabase/Vercel. You do all of it.

### LOCAL PROJECT FOLDER
`/Users/jamesbond/Documents/App/Unze Dashboard`

### YOUR TOOLS: FULL ACCESS. USE THEM YOURSELF.
- **GitHub:** repo `khuram1901/unze-cockpit`. Commit and push to main. Pushing main triggers the Vercel production deploy.
- **Supabase:** project `ffwdubfkcaoiyohscael` (Unze Dashboard). Full read/write via the Supabase MCP server, or the Supabase CLI / psql using `SUPABASE_DB_URL` in `.env.local`. Run every query, migration, RLS policy, function and check yourself.
- **Vercel:** project `unze-cockpit`. Deployments, build logs, env vars, promote and roll back.
- **Chrome:** test the live site `pulse.unze.co.uk` as the test users.

### HOW WE WORK: LIVE, ON MAIN, NO TEST SERVERS
- Work directly on main. No feature branches, no preview deployments, no test servers.
- Don't test SQL inside `BEGIN … ROLLBACK`. Apply changes straight to the live database, then verify with a query.
- Testing happens on the live site `pulse.unze.co.uk` after the production deploy.
- Other chats may also push to main. Always run `git pull --rebase` before every push. Never force-push. Never use `git reset --hard`.

### DATABASE: YOU RUN ALL SQL YOURSELF. NEVER ASK KHURAM TO.
- NEVER give SQL to paste into the Supabase SQL Editor. NEVER write "please run this in Supabase". If about to, run it yourself instead.
- If the connection fails, fix it yourself (reconnect MCP, re-link the CLI, check `.env.local`). Only if a credential is genuinely missing, tell Khuram in ONE line exactly what to get and where to click. He'll paste it once; store it in `.env.local` (which must stay in `.gitignore`) and carry on.
- Save every database change as a numbered migration file in `supabase/` and commit it.
- Before changing or deleting EXISTING rows, save a backup copy of those rows first (a backup table or a file in `docs/backups/`).
- Logins (`auth.users`): use `supabase.auth.admin` via the service role. Never raw SQL on `auth.users`.

### ONE-TIME SETUP (do this first if not already done each new session)
1. Confirm Supabase connection. Run `select current_user, now();` and note the output.
2. Ensure `.claude/settings.json` has `"permissions": { "allow": ["Bash(git:*)", "Bash(npm:*)", "Bash(npx:*)", "Bash(supabase:*)", "Bash(psql:*)", "Bash(vercel:*)"] }`.
3. Confirm the 3 test logins exist: `test.member@unze.co.uk`, `test.manager@unze.co.uk`, `test.ceo@unze.co.uk`. Password is in Vercel env var `TEST_USER_PASSWORD`. Never print it.

### STEP 0: READ THE CONTEXT (every new chat)
1. `CLAUDE.md` (this file)
2. `CLAUDE_SKILLS_CONTEXT.md` — workflows: frontend-design, debugging, database-safety, security-review
3. `GRAPH_REPORT.md` and `graphify-out/graph.json` for architecture
4. Everything in `docs/`, including `docs/retail-sales/DECISIONS.md`, `docs/visitors/DECISIONS.md`, `docs/generators/DECISIONS.md`
5. `claude/` folder
6. Top 2–3 entries in `sessions/summaries/INDEX.md`

### STEP 1: CURRENT STATE (short report)
- Last 5 commits on main, and the commit production is running, with its Vercel deployment ID
- Last applied Supabase migration number
- Any leftover test rows or test data in live tables

### STEP 2: APP-WIDE SECURITY CHECK (report only, one table)
Check: (a) every page has a server-side access check; (b) every API route checks identity AND authorisation — flag service-role use after login-only check; (c) data inside tabs is protected, not just the tab button; (d) RLS on every public table, SECURITY DEFINER functions have SET search_path, anon can't execute them; (e) store users can only reach /daily-sales and only their own store; (f) test accounts don't appear in headcounts, KPIs, host lists or reports.
Table: Area | Item | ✅/⚠️/❌ | Evidence | Risk. Put ❌ first. Then ask which page to check or what to fix.

### STEP 3: WHEN GIVEN A PAGE OR TASK
1. Read all code and database objects behind it: page, components, API routes, RPCs, tables, views, triggers, RLS.
2. Tell what it does today vs what it's meant to do (from DECISIONS.md, CLAUDE.md, commit history) — 5–8 plain bullets.
3. Check security, every button/form/upload, calculations (done in Supabase, totals tie out), data (mappings, duplicates, sample rows), look (SharedUI, money as PKR 1,234,567.50, works at 360px), errors (console, network, Vercel/Supabase logs).
4. Send ONE short report: Issues table (# | Severity | Issue | Evidence | Fix), up to 5 optional ideas, max 3 questions.
5. Wait for "APPROVED".

### STEP 4: AFTER "APPROVED", DO EVERYTHING WITHOUT ASKING AGAIN
1. Note the current production deployment ID (rollback point).
2. Make code changes; run `npm run build`; fix errors until it passes.
3. Apply database changes live, verify each with a query.
4. Commit, `git pull --rebase`, push to main; wait for Vercel production deploy to be Ready.
5. Test live on `pulse.unze.co.uk` in Chrome as all three test accounts.
6. Label any test entries as TEST, delete them, show count=0.
7. Smoke-test /home, /finance/imperial, /finance/imperial-pnl, Admin Operations, /members.
8. If anything is broken, fix straight away. If can't fix in 10 minutes, promote the rollback deployment.
9. Update the page's DECISIONS.md and CLAUDE.md; commit and push.
10. Final report: what changed, commits, migrations, deployment IDs, pass/fail live test table.

### PERMANENT RULES
- Never print, commit or write passwords or secrets anywhere.
- Never SQL on `auth.users`. Use `supabase.auth.admin` only.
- Never turn widget toggles on/off for real members. Only test accounts (or unless required for that function).
- Never delete or overwrite real business data without a one-line "yes" from Khuram in chat. Back it up first.
- Security is enforced on the server and in RLS. Hiding a button is never enough.
- Small, safe changes only. Don't refactor things not asked about. Suggest them instead.
