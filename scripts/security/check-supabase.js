#!/usr/bin/env node
/**
 * check-supabase.js
 * Calls the Supabase Management API Security Advisor (read-only).
 * Requires: SUPABASE_PROJECT_REF, SUPABASE_MANAGEMENT_API_TOKEN env vars.
 * Outputs: scripts/security/results/supabase-audit.json
 *
 * IMPORTANT: This script is READ-ONLY.
 * It never modifies the database, RLS policies, or any Supabase setting.
 * The SUPABASE_MANAGEMENT_API_TOKEN must be a narrowly-scoped read-only token.
 */

import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(process.cwd());
const OUT_DIR = join(ROOT, "scripts", "security", "results");
const OUT_FILE = join(OUT_DIR, "supabase-audit.json");

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const TOKEN = process.env.SUPABASE_MANAGEMENT_API_TOKEN;

// Never log the token itself
function redact(str) {
  if (!str) return "(empty)";
  return str.slice(0, 6) + "…[REDACTED]";
}

if (!PROJECT_REF) {
  console.error("ERROR: SUPABASE_PROJECT_REF environment variable is not set.");
  console.error("Set it as a GitHub repository variable (not a secret).");
  writeSkippedResult("SUPABASE_PROJECT_REF not configured");
  process.exit(0); // Exit 0 so workflow marks as skipped, not failed
}

if (!TOKEN) {
  console.error("ERROR: SUPABASE_MANAGEMENT_API_TOKEN is not set.");
  console.error("Create a read-only Management API token at app.supabase.com -> Account -> Access Tokens");
  writeSkippedResult("SUPABASE_MANAGEMENT_API_TOKEN not configured");
  process.exit(0);
}

console.log(`Supabase Security Advisor — project ref: ${PROJECT_REF}`);
console.log(`Using Management API token: ${redact(TOKEN)}`);

const BASE_URL = "https://api.supabase.com/v1";

async function apiGet(path) {
  const url = `${BASE_URL}${path}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "(unreadable)");
    // Redact any token that might appear in error body
    const safe = body.replace(TOKEN, "[REDACTED]");
    throw new Error(`API ${path} returned HTTP ${resp.status}: ${safe}`);
  }
  return resp.json();
}

function writeSkippedResult(reason) {
  mkdirSync(OUT_DIR, { recursive: true });
  const result = {
    tool: "supabase-security-advisor",
    timestamp: new Date().toISOString(),
    status: "skipped",
    reason,
    findings: [],
    counts: { critical: 0, high: 0, medium: 0, low: 0 },
  };
  writeFileSync(OUT_FILE, JSON.stringify(result, null, 2));
}

// Map Supabase advisor severity to our taxonomy
function mapSeverity(level) {
  const l = (level || "").toLowerCase();
  if (l === "error" || l === "critical") return "critical";
  if (l === "warn" || l === "warning" || l === "high") return "high";
  if (l === "info" || l === "medium") return "medium";
  return "low";
}

(async () => {
  const findings = [];

  // 1. Security Advisor — lint/security checks
  try {
    console.log("Fetching security advisor findings…");
    const advisors = await apiGet(`/projects/${PROJECT_REF}/advisors/security`);

    if (Array.isArray(advisors)) {
      for (const a of advisors) {
        const sev = mapSeverity(a.level || a.severity);
        findings.push({
          severity: sev,
          title: a.title || a.name || "Unnamed advisor finding",
          location: a.metadata?.schema
            ? `${a.metadata.schema}.${a.metadata.name || ""}`
            : (a.metadata?.table || "database"),
          detail: a.description || a.detail || "(no detail provided)",
          remediation: a.remediation || a.solution || "See Supabase Security Advisor in the dashboard.",
          source: "supabase-security-advisor",
          raw_level: a.level || a.severity,
        });
      }
      console.log(`Security Advisor returned ${advisors.length} finding(s).`);
    } else {
      console.warn("Unexpected response shape from Security Advisor:", JSON.stringify(advisors).slice(0, 200));
    }
  } catch (err) {
    console.error(`Security Advisor call failed: ${err.message}`);
    findings.push({
      severity: "high",
      title: "Supabase Security Advisor could not be reached",
      location: `api.supabase.com/v1/projects/${PROJECT_REF}/advisors/security`,
      detail: err.message,
      remediation: "Verify SUPABASE_MANAGEMENT_API_TOKEN is valid and has read access. Check network egress.",
      source: "supabase-security-advisor",
      scanner_error: true,
    });
  }

  // 2. Static checks against repository config that relate to Supabase
  // (These don't need the API — they inspect source files)
  const { readFileSync, existsSync, readdirSync } = await import("fs");

  // 2a. Check for service_role key usage in client-side code
  function grepFiles(dir, pattern, ext = /\.(ts|tsx|js|jsx)$/) {
    const hits = [];
    if (!existsSync(dir)) return hits;
    function walk(d) {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = `${d}/${e.name}`;
        if (e.isDirectory() && e.name !== "node_modules" && e.name !== ".git" && e.name !== ".next") {
          walk(full);
        } else if (e.isFile() && ext.test(e.name)) {
          const src = readFileSync(full, "utf8");
          if (pattern.test(src)) hits.push(full.replace(ROOT + "/", ""));
        }
      }
    }
    walk(dir);
    return hits;
  }

  // Service role in client-side files
  const clientDirs = [join(ROOT, "app"), join(ROOT, "lib")];
  for (const d of clientDirs) {
    const serviceRoleInClient = grepFiles(d, /SERVICE_ROLE/i).filter(f =>
      !f.includes("api-auth") &&
      !f.includes("supabase-server") &&
      !f.includes("route.ts") &&
      !f.includes("route.js")
    );
    for (const f of serviceRoleInClient) {
      findings.push({
        severity: "critical",
        title: "service_role key reference in potential client code",
        location: f,
        detail: "SERVICE_ROLE pattern found outside known server-only files. If this is in a client component or bundle, it exposes credentials that bypass all RLS.",
        remediation: "Move service role usage exclusively into API routes (route.ts) or server-only lib files.",
        source: "static-analysis",
      });
    }
  }

  // NEXT_PUBLIC + sensitive credential
  const publicCredPatterns = [
    { re: /NEXT_PUBLIC_.*SERVICE_ROLE/i, label: "service role key" },
    { re: /NEXT_PUBLIC_.*PRIVATE_KEY/i, label: "private key" },
    { re: /NEXT_PUBLIC_.*MANAGEMENT/i, label: "management API token" },
  ];
  for (const { re, label } of publicCredPatterns) {
    const hits = grepFiles(join(ROOT, "app"), re);
    if (hits.length) {
      findings.push({
        severity: "critical",
        title: `NEXT_PUBLIC_ variable contains ${label}`,
        location: hits.join(", "),
        detail: `A ${label} is declared as NEXT_PUBLIC_ which embeds it in the client bundle.`,
        remediation: "Move this to a server-only environment variable.",
        source: "static-analysis",
      });
    }
  }

  // Anonymous auth check (look for "anon" role in edge function or client config)
  const anonInPolicy = grepFiles(join(ROOT, "supabase"), /TO\s+anon\b/i, /\.sql$/);
  if (anonInPolicy.length > 0) {
    findings.push({
      severity: "medium",
      title: `${anonInPolicy.length} migration(s) grant access to the 'anon' role`,
      location: anonInPolicy.slice(0, 5).join(", "),
      detail: "RLS policies or GRANTs referencing 'anon' are accessible without authentication. Verify each is intentional.",
      remediation: "Review every anon grant. If anonymous access is not needed, remove the policy or restrict to 'authenticated'.",
      source: "static-analysis",
    });
  }

  // ─── Output ─────────────────────────────────────────────────────────────────
  mkdirSync(OUT_DIR, { recursive: true });

  const counts = {
    critical: findings.filter(f => f.severity === "critical").length,
    high: findings.filter(f => f.severity === "high").length,
    medium: findings.filter(f => f.severity === "medium").length,
    low: findings.filter(f => f.severity === "low").length,
  };

  const result = {
    tool: "supabase-security-advisor",
    timestamp: new Date().toISOString(),
    status: "complete",
    counts,
    findings,
  };

  writeFileSync(OUT_FILE, JSON.stringify(result, null, 2));

  console.log("\nSupabase Audit complete");
  console.log(`  Critical: ${counts.critical}  High: ${counts.high}  Medium: ${counts.medium}  Low: ${counts.low}`);
  console.log(`  Results: ${OUT_FILE}`);

  if (counts.critical > 0 || counts.high > 0) {
    console.error(`\nFAIL: ${counts.critical} critical + ${counts.high} high finding(s)`);
    process.exit(1);
  }
})();
