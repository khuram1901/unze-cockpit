# Security Architecture — Unze Dashboard

This document describes the automated and manual security controls for the
Unze Dashboard (CEO operating system for Unze Group).

---

## Security layers

| Layer | Tool | Trigger | Output |
|-------|------|---------|--------|
| A. Static analysis | GitHub CodeQL | PR + weekly | GitHub code-scanning alerts |
| B. Dependency CVEs | npm audit | PR + weekly | Issue comment |
| C. Secret detection | Gitleaks (binary) | PR + weekly | Issue comment |
| D. SAST | Semgrep Community | PR + weekly | Issue comment + SARIF |
| E. Database security | Supabase Security Advisor | Weekly only | Issue comment |
| F. Config audit | Custom Node.js script | PR + weekly | Issue comment |
| G. Deployed-app scan | OWASP ZAP Baseline | Weekly only | Private artifact |
| H. Consolidated report | consolidate-report.js | Always last | GitHub issue |

---

## Quick-start: setting up secrets and variables

Go to **GitHub → Repository → Settings → Secrets and variables → Actions**.

### Variables (not secret — readable in logs)

| Name | Where to find it | Required for |
|------|-----------------|--------------|
| `SUPABASE_PROJECT_REF` | Supabase dashboard → Project settings → General → Reference ID | Supabase audit job |
| `STAGING_URL` | Your Vercel preview URL or dedicated staging deployment | ZAP scan |

### Secrets (never readable after entry)

| Name | How to obtain | Required for |
|------|--------------|--------------|
| `SUPABASE_MANAGEMENT_API_TOKEN` | app.supabase.com → Account (top-right avatar) → Access Tokens → Generate new token (read-only) | Supabase audit job |

**Do NOT add:**
- `SUPABASE_SERVICE_ROLE_KEY` — not needed by the audit workflow
- Personal Vercel account token — config audit is static; no Vercel API access needed
- Production DB password

---

## Pin actions to SHAs (required before production use)

All third-party GitHub Action references marked `# FIXME:PIN` in the workflow
must be pinned to an immutable commit SHA to prevent supply-chain attacks.

```bash
# Resolve a tag to its commit SHA:
gh api /repos/OWNER/REPO/git/ref/tags/TAG | jq -r '.object.sha'

# Examples:
gh api /repos/zaproxy/action-baseline/git/ref/tags/v0.14.0 | jq -r '.object.sha'
gh api /repos/github/codeql-action/git/ref/tags/codeql-bundle-v3.28.1 | jq -r '.object.sha'

# Then replace in the workflow:
#   uses: zaproxy/action-baseline@v0.14.0
# becomes:
#   uses: zaproxy/action-baseline@<resolved-sha>  # v0.14.0
```

Alternatively, install [pin-github-action](https://github.com/mheap/pin-github-action)
or [Ratchet](https://github.com/sethvargo/ratchet) to automate the process:

```bash
# Using ratchet:
ratchet pin .github/workflows/weekly-security-audit.yml
```

---

## Verify the Gitleaks checksum

The workflow downloads Gitleaks `v8.21.2` and verifies a SHA-256 checksum.
To update the version or verify the current checksum:

```bash
VERSION="8.21.2"
TARBALL="gitleaks_${VERSION}_linux_x64.tar.gz"
curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${TARBALL}" -o /tmp/${TARBALL}
sha256sum /tmp/${TARBALL}
# Update GITLEAKS_TARBALL_SHA256 in the workflow env block
```

---

## Manual security checks schedule

| Check | Frequency | Owner |
|-------|-----------|-------|
| Supabase Security Advisor dashboard review | Quarterly | Developer |
| RLS spot-check (5–10 tables) | Quarterly | Developer |
| PA role isolation test | Quarterly | CEO / Developer |
| Supabase Auth settings review | Quarterly | Developer |
| Storage bucket audit | Quarterly | Developer |
| GitHub Actions secrets rotation | Annually | Developer |
| Review `fetch-pension-prices.yml` service-role usage | Annually | Developer |
| Dependency major updates (after Dependabot PR review) | As needed | Developer |

---

## How results are published

1. Each scan job uploads a JSON artifact.
2. The `consolidate` job downloads all artifacts, runs `consolidate-report.js`,
   and generates `WEEKLY_SECURITY_REPORT.md`.
3. The report is posted to the GitHub issue titled **"Weekly Security Audit"**
   (label: `security-audit`). Each run adds a comment for history.
4. The full report Markdown is also uploaded as a private workflow artifact
   (retained 90 days).

### Overall result logic

| Result | Condition |
|--------|-----------|
| ✅ PASS | No Critical, High, or Medium findings; all mandatory scanners ran |
| ⚠️ PASS WITH WARNINGS | Only Medium/Low findings; all mandatory scanners ran |
| ❌ FAIL | Any Critical or High finding, or active credential exposure |
| 🔴 INCOMPLETE | A mandatory scanner failed or produced no output |

The audit is **never labelled PASS if a mandatory scanner was skipped** — it is
marked INCOMPLETE instead.

---

## Architecture decisions

### Why no middleware.ts?

Authentication is enforced per-route via `requireAuth()` in `app/lib/api-auth.ts`.
This is a deliberate architectural choice. The security implication is that any
new route that omits `requireAuth()` would be publicly accessible. The Vercel
Config Audit script (`check-vercel-config.js`) scans for routes missing this
call on every PR and weekly run.

**Recommendation:** Add a Next.js middleware as a defence-in-depth layer for all
`/app/*` routes. Tracked in `SECURITY_CHECKLIST.md §3`.

### Why Gitleaks binary instead of the GitHub Action?

Using `gitleaks/gitleaks-action` would add a third-party supply-chain dependency.
Downloading the binary directly with a verified SHA-256 checksum is more secure
and auditable. The checksum must be updated when the Gitleaks version changes.

### Why Semgrep via pip instead of the Semgrep action?

Same rationale: avoids trusting `semgrep/semgrep-action` for script execution.
The pinned pip version (`semgrep==1.90.0`) is deterministic and auditable.

### What the Supabase audit covers (and does not cover)

**Covers (automated):**
- Security Advisor findings via the Management API
- `service_role` key references in client-side code (static)
- `NEXT_PUBLIC_` variables containing sensitive credentials (static)
- `anon` role grants in migration files (static)

**Does not cover (manual review required):**
- Individual RLS policy correctness (logic errors that aren't caught by the advisor)
- Auth redirect URL configuration (only visible in Supabase dashboard)
- Storage bucket object-level policies for specific files
- Edge Function authentication configuration

---

## Incident response

If Gitleaks finds an active secret:

1. **Immediately rotate** the exposed credential (do not wait for the audit issue).
2. Notify the relevant service provider.
3. Remove the secret from git history using `git-filter-repo` (not `git filter-branch`).
4. Force-push to all affected branches and notify all contributors to re-clone.
5. Re-run the security workflow to confirm zero findings.
6. Document the incident in `CHANGELOG.md`.
