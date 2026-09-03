# Security Checklist — Unze Dashboard

Manual checks that automated scanners cannot perform.
Review quarterly unless a more frequent interval is noted.

**Reviewer:** ________________________  **Date:** ____________  **Result:** PASS / FAIL WITH NOTES

---

## §1 — Supabase Dashboard

Requires login to app.supabase.com → your project.

- [ ] **Security Advisor:** Open Advisors → Security. Review every finding.
      Copy finding count here: Critical __ / High __ / Medium __ / Low __
- [ ] **RLS enabled:** Open Table Editor → pick 5–10 random tables → confirm RLS toggle is ON.
      Tables verified: ___________________________________________
- [ ] **RLS policies:** For each verified table, click "Policies". Confirm:
      - At least one SELECT policy exists.
      - No policy uses `USING (true)` without documented justification.
      - UPDATE policies have both USING and WITH CHECK.
- [ ] **No user_metadata in policies:** Search policies for `user_metadata` or
      `raw_user_meta_data`. Flag any found — these are user-controlled and unsafe.
- [ ] **Anonymous auth:** Auth → Providers. Confirm "Anonymous" is DISABLED
      (unless intentionally used with a documented reason).
- [ ] **Auth redirect URLs:** Auth → URL Configuration. Confirm the allowlist contains
      only your production and staging domains. No wildcard entries unless necessary.
- [ ] **Email confirmations:** Auth → Email → confirm "Enable email confirmations" is ON.
- [ ] **Storage buckets:** Storage → Buckets. List all public buckets:
      Public buckets: _________________________________________
      Confirm each public bucket contains only intentionally public, non-sensitive files.
- [ ] **Edge Functions:** Functions. For any functions that handle user data, confirm
      "Verify JWT" is ENABLED (not disabled).
- [ ] **Extensions:** Database → Extensions. Note any security-sensitive extensions
      and confirm they are on a current version:
      pg_cron: ___ / pgsodium: ___ / vault: ___

---

## §2 — Security Headers (Missing — Tracked)

These headers are not yet set in `next.config.ts`. Each PR touching `next.config.ts`
should move toward resolving this.

- [ ] `X-Frame-Options: DENY` — prevents clickjacking
- [ ] `X-Content-Type-Options: nosniff` — prevents MIME sniffing
- [ ] `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- [ ] `Referrer-Policy: strict-origin-when-cross-origin`
- [ ] `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- [ ] Content Security Policy (requires audit of all inline scripts / external sources first)

**Status:** Open — assign to a dedicated security PR, not mixed with feature work.
**Responsible:** ___________  **Target date:** ___________

---

## §3 — Authentication Coverage

- [ ] **All API routes call requireAuth:** Run the Vercel Audit script locally:
      `node scripts/security/check-vercel-config.js`
      Confirm zero unprotected route findings.
- [ ] **PA role isolation:** Log in as the PA user (Executive role).
      Confirm the following are NOT accessible:
      - Finance tab / any finance page
      - P&L data in any form
      - Bank / guarantee / investment data
      - Member salary or payroll data
- [ ] **Consider middleware.ts:** A Next.js middleware that validates the session
      for all non-public routes would provide a defence-in-depth layer.
      Status: __ Under consideration / __ Implemented / __ Decision: not needed because ___

---

## §4 — Cron Endpoint Protection

- [ ] All routes listed in `vercel.json` → `crons` check `CRON_SECRET`.
      Routes verified with `check-vercel-config.js`: PASS / FAIL
- [ ] Routes using `isCron || isAuth` pattern — verify the authenticated path:
      - `app/api/investments/update-prices/route.ts` — auth path capability check: ___
      - `app/api/investments/fetch-dividends/route.ts` — auth path capability check: ___
      - `app/api/backup/route.ts` — auth path capability check: ___
- [ ] `CRON_SECRET` is set as a Vercel environment variable (not hardcoded).

---

## §5 — Environment Variables

- [ ] Open Vercel → Project → Settings → Environment Variables.
      Confirm `SUPABASE_SERVICE_ROLE_KEY` is set to **Production only** (not Preview).
      Similarly for `CRON_SECRET`, `ANTHROPIC_API_KEY`, `VAPID_PRIVATE_KEY`.
- [ ] Confirm no `NEXT_PUBLIC_` variables contain server-only credentials.
      (Automated check via `check-vercel-config.js` — verify it passes.)
- [ ] `.env.local` is listed in `.gitignore`. Check:
      `grep -l "\.env\.local" .gitignore`
- [ ] No `.env`, `.env.production`, or `.env.staging` file committed to the repository.
      `git log --all --full-history -- '.env' '.env.production'`

---

## §6 — GitHub Actions Security

- [ ] Go to GitHub → Settings → Secrets and variables → Actions.
      Verify only the minimum secrets are stored:
      - `SUPABASE_MANAGEMENT_API_TOKEN` — present, read-only token
      - No `SUPABASE_SERVICE_ROLE_KEY` in the security audit workflow's secrets
        (it exists in `fetch-pension-prices.yml` — see §7)
- [ ] Review `GITHUB_TOKEN` permissions on each workflow:
      `weekly-security-audit.yml` — `permissions: contents: read` + minimal extras: PASS / FAIL
      `fetch-pension-prices.yml` — no `permissions` block (defaults to repo settings): NOTE
- [ ] Check GitHub's own secret scanning: Security → Secret scanning alerts.
      Count of active alerts: ___
- [ ] Dependabot: Security → Dependabot alerts.
      Count of active alerts: ___

---

## §7 — fetch-pension-prices.yml Service Role Usage

This workflow uses `SUPABASE_SERVICE_ROLE_KEY` to upsert pension fund prices.
The service role key bypasses all RLS. If this secret is compromised, an
attacker has unrestricted database access.

**Mitigation options (choose one):**

Option A — Narrow Postgres role (recommended):
```sql
-- Create a minimal role with only INSERT/UPDATE on the specific table
CREATE ROLE pension_writer LOGIN PASSWORD 'strong-random-password';
GRANT INSERT, UPDATE ON pension_fund_prices TO pension_writer;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM pension_writer;
-- Use the connection string (not service_role key) in the workflow secret
```

Option B — Accept current risk:
Document acceptance: the workflow runs only in GitHub Actions with a protected
secret, reducing the attack surface. Review this decision annually.

- [ ] **Current status:** Option A implemented / Option B accepted / Decision pending
- [ ] **If Option B:** Last review date: ____________

---

## §8 — Vercel Deployment Protection

- [ ] Vercel → Project → Settings → Deployment Protection.
      Confirm "Vercel Authentication" or equivalent protection is enabled for Preview deployments.
- [ ] Confirm Preview deployments do NOT have access to production Supabase credentials.
- [ ] Source maps in production: Open your production URL in DevTools → Sources.
      Confirm original TypeScript source is NOT visible.

---

## §9 — Dependency Review

Review the Dependabot PRs opened this quarter.

- [ ] All PRs reviewed — none auto-merged without review.
- [ ] Major version updates tested in a branch before merging.
- [ ] `next` version: only upgrade with a dedicated PR + smoke test.

---

## Sign-off

| Item | Findings | Severity |
|------|----------|----------|
| §1 Supabase | | |
| §2 Headers | Missing — tracked | Medium |
| §3 Auth | | |
| §4 Cron | | |
| §5 Env vars | | |
| §6 Actions | | |
| §7 Pension workflow | | |
| §8 Vercel protection | | |
| §9 Dependencies | | |

**Overall result this quarter:** PASS / PASS WITH NOTES / FAIL

**Notes / action items:**

_____________________________________________________________
_____________________________________________________________

**Signed:** ________________________  **Date:** ____________
