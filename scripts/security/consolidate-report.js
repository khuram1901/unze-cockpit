#!/usr/bin/env node
/**
 * consolidate-report.js
 * Reads all individual scanner result JSONs and produces a single Markdown report.
 * Called by the GitHub Actions "consolidate" job after all scanners complete.
 *
 * Usage: node consolidate-report.js [--prev-report <path>]
 * Env:   GITHUB_RUN_ID, GITHUB_RUN_NUMBER, GITHUB_SERVER_URL, GITHUB_REPOSITORY
 * Output: scripts/security/results/WEEKLY_SECURITY_REPORT.md
 *         Exit 1 if overall result is FAIL or INCOMPLETE.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(process.cwd());
const RESULTS_DIR = join(ROOT, "scripts", "security", "results");
const REPORT_FILE = join(RESULTS_DIR, "WEEKLY_SECURITY_REPORT.md");

const RUN_ID = process.env.GITHUB_RUN_ID || "local";
const RUN_NUM = process.env.GITHUB_RUN_NUMBER || "?";
const GH_URL = process.env.GITHUB_SERVER_URL || "https://github.com";
const GH_REPO = process.env.GITHUB_REPOSITORY || "unknown/repo";
const RUN_URL = `${GH_URL}/${GH_REPO}/actions/runs/${RUN_ID}`;
const TODAY = new Date().toISOString().slice(0, 10);

// ─── Load result files ────────────────────────────────────────────────────────
function loadJSON(file) {
  const path = join(RESULTS_DIR, file);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { return { tool: file, status: "parse-error", findings: [], counts: {} }; }
}

// Tool names → result files
const TOOLS = [
  { id: "codeql",         file: "codeql-summary.json",      name: "GitHub CodeQL",          mandatory: true  },
  { id: "npm-audit",      file: "npm-audit.json",            name: "npm audit",               mandatory: true  },
  { id: "gitleaks",       file: "gitleaks.json",             name: "Gitleaks (secret scan)",  mandatory: true  },
  { id: "semgrep",        file: "semgrep.json",              name: "Semgrep SAST",            mandatory: true  },
  { id: "supabase",       file: "supabase-audit.json",       name: "Supabase Security Advisor", mandatory: false },
  { id: "vercel",         file: "vercel-audit.json",         name: "Vercel/Config Audit",     mandatory: true  },
  { id: "zap",            file: "zap-report.json",           name: "OWASP ZAP Baseline",      mandatory: false },
];

const results = {};
for (const tool of TOOLS) {
  results[tool.id] = loadJSON(tool.file);
}

// ─── Aggregate findings ───────────────────────────────────────────────────────
const ALL_FINDINGS = [];
const SCANNER_STATUS = [];
let mandatoryFailed = false;
let hasCredentialExposure = false;

for (const tool of TOOLS) {
  const r = results[tool.id];
  if (!r) {
    SCANNER_STATUS.push({ ...tool, ran: false, status: "missing" });
    if (tool.mandatory) mandatoryFailed = true;
    continue;
  }
  const skipped = r.status === "skipped";
  const errored = r.status === "error" || r.status === "parse-error";
  SCANNER_STATUS.push({ ...tool, ran: !skipped && !errored, status: r.status || "complete" });
  if (errored && tool.mandatory) mandatoryFailed = true;

  if (Array.isArray(r.findings)) {
    for (const f of r.findings) {
      ALL_FINDINGS.push({ ...f, _tool: tool.name, _toolId: tool.id });
      // Check for active credential exposure
      if ((f.severity === "critical") &&
          (f.title?.toLowerCase().includes("secret") ||
           f.title?.toLowerCase().includes("credential") ||
           f.title?.toLowerCase().includes("token") ||
           f.title?.toLowerCase().includes("key"))) {
        hasCredentialExposure = true;
      }
    }
  }
}

// Also parse npm audit output (it has a different shape)
const npmRaw = loadJSON("npm-audit-raw.json");
if (npmRaw) {
  const vulns = npmRaw.vulnerabilities || {};
  for (const [pkg, info] of Object.entries(vulns)) {
    if (info.severity === "critical" || info.severity === "high") {
      const existing = ALL_FINDINGS.find(f => f._toolId === "npm-audit" && f.title?.includes(pkg));
      if (!existing) {
        ALL_FINDINGS.push({
          severity: info.severity,
          title: `Vulnerable dependency: ${pkg}@${info.range || "unknown"}`,
          location: "package.json / package-lock.json",
          detail: (info.via || []).map(v => typeof v === "string" ? v : v.title || "").join("; "),
          remediation: `Run: npm audit fix --force (review changes). Or update ${pkg} manually.`,
          _tool: "npm audit",
          _toolId: "npm-audit",
        });
      }
    }
  }
}

// ─── Severity buckets ─────────────────────────────────────────────────────────
const bySeverity = { critical: [], high: [], medium: [], low: [], info: [] };
for (const f of ALL_FINDINGS) {
  const sev = (f.severity || "info").toLowerCase();
  if (bySeverity[sev]) bySeverity[sev].push(f);
  else bySeverity.info.push(f);
}

// ─── Overall result ───────────────────────────────────────────────────────────
let overallResult;
if (mandatoryFailed) {
  overallResult = "INCOMPLETE";
} else if (bySeverity.critical.length > 0 || bySeverity.high.length > 0 || hasCredentialExposure) {
  overallResult = "FAIL";
} else if (bySeverity.medium.length > 0) {
  overallResult = "PASS WITH WARNINGS";
} else {
  overallResult = "PASS";
}

const resultEmoji = {
  "PASS": "✅",
  "PASS WITH WARNINGS": "⚠️",
  "FAIL": "❌",
  "INCOMPLETE": "🔴",
}[overallResult] || "❓";

// ─── Build report ─────────────────────────────────────────────────────────────
function sev2emoji(s) {
  return { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵", pass: "✅", info: "ℹ️" }[s] || "⚪";
}

function findingMd(f, idx) {
  const loc = f.location ? `\`${f.location}\`` : "_unknown_";
  const lines = [
    `#### ${idx + 1}. ${sev2emoji(f.severity)} ${f.title || "Unnamed finding"}`,
    `| Field | Value |`,
    `|-------|-------|`,
    `| **Tool** | ${f._tool || "unknown"} |`,
    `| **Location** | ${loc} |`,
    `| **Severity** | ${(f.severity || "?").toUpperCase()} |`,
    `| **Evidence** | ${(f.detail || "—").replace(/\n/g, " ").slice(0, 300)} |`,
    `| **Impact** | ${f.impact || "See remediation below."} |`,
    `| **Remediation** | ${(f.remediation || "—").replace(/\n/g, " ").slice(0, 400)} |`,
    `| **Verification** | ${f.verification || "After applying fix, re-run the security workflow and confirm finding no longer appears."} |`,
    "",
  ];
  return lines.join("\n");
}

function sectionMd(title, findings) {
  if (findings.length === 0) return `### ${title}\n\n_No findings._\n\n`;
  return `### ${title}\n\n${findings.map((f, i) => findingMd(f, i)).join("\n")}\n`;
}

const scannerTable = SCANNER_STATUS.map(t => {
  const icon = t.ran ? "✅" : (t.status === "skipped" ? "⏭️" : "❌");
  const status = t.ran ? "Ran" : (t.status === "skipped" ? "Skipped" : `**FAILED** (${t.status})`);
  const mandatory = t.mandatory ? "Yes" : "No";
  return `| ${t.name} | ${icon} ${status} | ${mandatory} |`;
}).join("\n");

const report = `# Weekly Security Audit — Unze Dashboard

> **Run:** [#${RUN_NUM}](${RUN_URL}) · **Date:** ${TODAY} · **Result:** ${resultEmoji} **${overallResult}**

---

## 1. Executive Summary

| Metric | Count |
|--------|-------|
| 🔴 Critical | ${bySeverity.critical.length} |
| 🟠 High | ${bySeverity.high.length} |
| 🟡 Medium | ${bySeverity.medium.length} |
| 🔵 Low | ${bySeverity.low.length} |
| ℹ️ Info | ${bySeverity.info.length} |
| **Overall** | **${resultEmoji} ${overallResult}** |

${overallResult === "INCOMPLETE" ? "> ⚠️ **INCOMPLETE**: One or more mandatory scanners did not produce results. The audit cannot be considered valid until all scanners run successfully." : ""}
${overallResult === "FAIL" ? "> ❌ **FAIL**: Critical or High severity findings require remediation before this result can be cleared." : ""}
${overallResult === "PASS WITH WARNINGS" ? "> ⚠️ Medium-severity findings detected. No immediate action required but remediation is recommended." : ""}
${overallResult === "PASS" ? "> ✅ No Critical, High, or Medium findings. Continue to monitor." : ""}

---

## 2. Scan Coverage

| Tool | Status | Mandatory |
|------|--------|-----------|
${scannerTable}

---

## 3. Findings

${sectionMd("🔴 Critical", bySeverity.critical)}
${sectionMd("🟠 High", bySeverity.high)}
${sectionMd("🟡 Medium", bySeverity.medium)}
${sectionMd("🔵 Low", bySeverity.low)}

---

## 4. Failed or Skipped Checks

${SCANNER_STATUS.filter(t => !t.ran).length === 0
  ? "_All scanners ran successfully._"
  : SCANNER_STATUS.filter(t => !t.ran).map(t =>
      `- **${t.name}**: ${t.status} — ${t.mandatory ? "**MANDATORY** — audit is INCOMPLETE without this" : "Optional"}`
    ).join("\n")
}

---

## 5. Manual Verification Required

These items cannot be checked automatically and must be reviewed manually each quarter:

- [ ] **Supabase dashboard**: Review Security Advisor in full at [app.supabase.com](https://app.supabase.com) → Project → Advisors → Security
- [ ] **RLS policies**: Spot-check 5–10 tables per quarter. Confirm USING and WITH CHECK match the intended access pattern.
- [ ] **PA role isolation**: Log in as the PA user and confirm no financial data is visible.
- [ ] **Supabase Auth settings**: Verify anonymous auth is disabled, email confirmations are enabled, and redirect URLs are restricted.
- [ ] **Vercel Deployment Protection**: Confirm Preview deployments are protected and not using production secrets.
- [ ] **Storage buckets**: Confirm no storage bucket is public unless deliberately serving public assets.
- [ ] **GitHub Actions secrets**: Rotate SUPABASE_MANAGEMENT_API_TOKEN annually. Confirm no leaked secrets via GitHub's secret scanning alerts.
- [ ] **\`fetch-pension-prices.yml\`**: Evaluate migrating from \`SUPABASE_SERVICE_ROLE_KEY\` to a narrowly-scoped DB user (see SECURITY_CHECKLIST.md §7).

---

## 6. Remediation Priority Queue

${[...bySeverity.critical, ...bySeverity.high, ...bySeverity.medium]
  .slice(0, 10)
  .map((f, i) => `${i + 1}. **[${(f.severity||"?").toUpperCase()}]** ${f.title} — \`${f.location || "?"}\``)
  .join("\n") || "_No actionable findings._"}

---

_Report generated by the Unze Dashboard automated security audit. Do not commit changes based solely on this report without human review._
`;

writeFileSync(REPORT_FILE, report);
console.log(`\nReport written: ${REPORT_FILE}`);
console.log(`Overall result: ${overallResult}`);

// Write a compact summary for the GitHub issue comment
const issueSummary = {
  overallResult,
  resultEmoji,
  counts: {
    critical: bySeverity.critical.length,
    high: bySeverity.high.length,
    medium: bySeverity.medium.length,
    low: bySeverity.low.length,
  },
  mandatoryFailed,
  scannerStatus: SCANNER_STATUS.map(t => ({ name: t.name, ran: t.ran, status: t.status, mandatory: t.mandatory })),
  reportFile: REPORT_FILE,
};
writeFileSync(join(RESULTS_DIR, "issue-summary.json"), JSON.stringify(issueSummary, null, 2));

if (overallResult === "FAIL" || overallResult === "INCOMPLETE") process.exit(1);
