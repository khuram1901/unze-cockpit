#!/usr/bin/env node
/**
 * check-vercel-config.js
 * Static security audit of Next.js / Vercel configuration.
 * Reads source files only — makes no network calls, touches no secrets.
 * Outputs: scripts/security/results/vercel-audit.json
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(process.cwd());
const OUT_DIR = join(ROOT, "scripts", "security", "results");
const OUT_FILE = join(OUT_DIR, "vercel-audit.json");

const findings = [];
let pass = 0;
let warn = 0;
let fail = 0;

function finding(severity, title, location, detail, remediation) {
  findings.push({ severity, title, location, detail, remediation });
  if (severity === "critical" || severity === "high") fail++;
  else if (severity === "medium") warn++;
  else pass++;
}

function ok(title) {
  findings.push({ severity: "pass", title });
  pass++;
}

function readFile(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, "utf8");
}

// ─── 1. Security headers ──────────────────────────────────────────────────────
const nextConfig = readFile("next.config.ts") || readFile("next.config.js") || "";

if (!nextConfig.includes("X-Frame-Options") && !nextConfig.includes("x-frame-options")) {
  finding("high", "Missing X-Frame-Options header", "next.config.ts",
    "No X-Frame-Options or frame-ancestors CSP directive detected. Pages can be embedded in iframes, enabling clickjacking.",
    "Add 'X-Frame-Options: DENY' in next.config.ts headers().");
} else { ok("X-Frame-Options header present"); }

if (!nextConfig.includes("Strict-Transport-Security") && !nextConfig.includes("strict-transport-security")) {
  finding("medium", "Missing HSTS header", "next.config.ts",
    "Strict-Transport-Security not set — browsers may fall back to HTTP on first visit.",
    "Add 'Strict-Transport-Security: max-age=63072000; includeSubDomains; preload'.");
} else { ok("HSTS header present"); }

if (!nextConfig.includes("X-Content-Type-Options")) {
  finding("medium", "Missing X-Content-Type-Options header", "next.config.ts",
    "MIME-type sniffing not disabled — some browsers may interpret files as executable.",
    "Add 'X-Content-Type-Options: nosniff'.");
} else { ok("X-Content-Type-Options present"); }

if (!nextConfig.includes("Referrer-Policy")) {
  finding("low", "Missing Referrer-Policy header", "next.config.ts",
    "No Referrer-Policy — full referrer URLs may leak to third-party requests.",
    "Add 'Referrer-Policy: strict-origin-when-cross-origin'.");
} else { ok("Referrer-Policy present"); }

if (!nextConfig.includes("Content-Security-Policy") && !nextConfig.includes("content-security-policy")) {
  finding("medium", "No Content Security Policy", "next.config.ts",
    "No CSP header detected. XSS attacks lack a defence-in-depth layer.",
    "Define a CSP after auditing all inline scripts and external sources.");
} else { ok("CSP header present"); }

if (nextConfig.includes("productionBrowserSourceMaps: true")) {
  finding("medium", "Production source maps enabled", "next.config.ts",
    "productionBrowserSourceMaps:true exposes server-side logic in the browser.",
    "Remove productionBrowserSourceMaps or ensure it is false in production.");
} else { ok("Production source maps not explicitly enabled"); }

// ─── 2. Vercel cron configuration ────────────────────────────────────────────
const vercelJson = readFile("vercel.json");
if (vercelJson) {
  let vConf;
  try { vConf = JSON.parse(vercelJson); } catch { vConf = {}; }
  const cronPaths = (vConf.crons || []).map(c => c.path);

  for (const path of cronPaths) {
    // Derive the route file path from the cron path
    const routeFile = join(ROOT, "app", "api", ...path.replace(/^\/api\//, "").split("/"), "route.ts");
    const routeSrc = existsSync(routeFile) ? readFileSync(routeFile, "utf8") : null;

    if (!routeSrc) {
      finding("low", `Cron route source not found: ${path}`, `vercel.json + app/api${path.replace(/^\/api/, "")}/route.ts`,
        "Could not read the route source to verify CRON_SECRET protection.",
        "Ensure the route exists and verify it checks Authorization: Bearer CRON_SECRET.");
      continue;
    }

    const hasCronCheck = routeSrc.includes("CRON_SECRET");
    if (!hasCronCheck) {
      finding("high", `Cron endpoint missing CRON_SECRET check: ${path}`,
        `app/api${path.replace(/^\/api/, "")}/route.ts`,
        "This Vercel cron endpoint does not check CRON_SECRET — any caller can trigger it.",
        "Add: if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) return 401.");
    } else {
      ok(`CRON_SECRET check present: ${path}`);
    }
  }
} else {
  finding("low", "vercel.json not found", "vercel.json",
    "Cannot audit cron endpoint protection without vercel.json.",
    "Ensure vercel.json is present in the repository root.");
}

// ─── 3. NEXT_PUBLIC_ variable audit ──────────────────────────────────────────
const sensitivePatterns = [
  { pattern: /NEXT_PUBLIC_.*SERVICE_ROLE/i, label: "Supabase service role key" },
  { pattern: /NEXT_PUBLIC_.*PRIVATE/i, label: "Private key" },
  { pattern: /NEXT_PUBLIC_.*SECRET/i, label: "Secret" },
  { pattern: /NEXT_PUBLIC_ANTHROPIC/i, label: "Anthropic API key" },
  { pattern: /NEXT_PUBLIC_.*PASSWORD/i, label: "Password" },
  { pattern: /NEXT_PUBLIC_.*TOKEN(?!_TYPE)/i, label: "Token" },
  { pattern: /NEXT_PUBLIC_TELEGRAM/i, label: "Telegram token" },
  { pattern: /NEXT_PUBLIC_FLOWHCM/i, label: "FlowHCM credential" },
  { pattern: /NEXT_PUBLIC_FOLDERIT/i, label: "Folderit credential" },
  { pattern: /NEXT_PUBLIC_VAPID_PRIVATE/i, label: "VAPID private key" },
];

// Check .env files (flag if accidentally committed — should be in .gitignore)
for (const envFile of [".env", ".env.local", ".env.production"]) {
  const envContent = readFile(envFile);
  if (envContent) {
    // Check for sensitive NEXT_PUBLIC_ vars
    for (const { pattern, label } of sensitivePatterns) {
      if (pattern.test(envContent)) {
        finding("critical", `${label} in NEXT_PUBLIC_ variable`, envFile,
          `A ${label} appears to be declared as a NEXT_PUBLIC_ variable, which will be embedded in the client-side bundle.`,
          "Move this to a server-only environment variable (without NEXT_PUBLIC_ prefix).");
      }
    }
    if (envFile !== ".env.local") {
      finding("high", `${envFile} committed to repository`, envFile,
        "Environment files with real credentials should never be committed to version control.",
        "Add this file to .gitignore and rotate any exposed credentials immediately.");
    }
  }
}

// ─── 4. Middleware coverage ────────────────────────────────────────────────────
const middlewareExists = existsSync(join(ROOT, "middleware.ts")) || existsSync(join(ROOT, "middleware.js"));
if (!middlewareExists) {
  finding("medium", "No middleware.ts detected", "middleware.ts (missing)",
    "Authentication is enforced per-route rather than at the middleware layer. A new route added without requireAuth() would be publicly accessible.",
    "Consider adding a Next.js middleware that validates the session for all /app/* routes as a defence-in-depth layer, in addition to per-route requireAuth().");
} else {
  ok("middleware.ts present");
}

// ─── 5. API route requireAuth audit (sample) ─────────────────────────────────
import { readdirSync } from "fs";

function findRoutes(dir, routes = []) {
  if (!existsSync(dir)) return routes;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findRoutes(full, routes);
    else if (entry.name === "route.ts" || entry.name === "route.js") routes.push(full);
  }
  return routes;
}

const apiDir = join(ROOT, "app", "api");
const routes = findRoutes(apiDir);
const unprotectedRoutes = [];

for (const routePath of routes) {
  const src = readFileSync(routePath, "utf8");
  const rel = routePath.replace(ROOT + "/", "");

  // Skip known-public or cron-only routes
  const isHealthCheck = rel.includes("/health/");
  const isCronOnly = src.includes("CRON_SECRET") && !src.includes("requireAuth");
  const hasCronOrAuth = src.includes("CRON_SECRET") || src.includes("requireAuth");

  if (isHealthCheck) continue; // health check may be intentionally public
  if (isCronOnly) continue;    // cron-only endpoints checked above

  if (!src.includes("requireAuth") && !src.includes("CRON_SECRET")) {
    // Only flag routes that export HTTP handlers
    const hasHandler = /export (async )?function (GET|POST|PUT|PATCH|DELETE|HEAD)/g.test(src);
    if (hasHandler) {
      unprotectedRoutes.push(rel);
    }
  }
}

if (unprotectedRoutes.length > 0) {
  finding("high", `${unprotectedRoutes.length} API route(s) may lack authentication`,
    unprotectedRoutes.slice(0, 10).join(", "),
    `These routes export HTTP handlers but do not appear to call requireAuth() or check CRON_SECRET:\n${unprotectedRoutes.slice(0, 20).join("\n")}`,
    "Add requireAuth(request) as the first call in every handler. If public, document why.");
} else {
  ok("All sampled API routes appear to use requireAuth() or CRON_SECRET");
}

// ─── 6. Existing workflow security ────────────────────────────────────────────
const pensionWorkflow = readFile(".github/workflows/fetch-pension-prices.yml") || "";
if (pensionWorkflow.includes("SUPABASE_SERVICE_ROLE_KEY")) {
  finding("medium", "SUPABASE_SERVICE_ROLE_KEY used in GitHub Actions workflow",
    ".github/workflows/fetch-pension-prices.yml",
    "The service role key bypasses all RLS policies. If the GitHub Actions secret is compromised, an attacker has unrestricted database access.",
    "Create a narrowly scoped Postgres role with only INSERT/UPDATE on `pension_fund_prices` and use its credentials instead. See docs/security/SECURITY_CHECKLIST.md.");
}

// ─── Output ───────────────────────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true });

const summary = {
  tool: "vercel-config-audit",
  timestamp: new Date().toISOString(),
  counts: { critical: findings.filter(f => f.severity === "critical").length,
             high: findings.filter(f => f.severity === "high").length,
             medium: findings.filter(f => f.severity === "medium").length,
             low: findings.filter(f => f.severity === "low").length,
             pass },
  findings: findings.filter(f => f.severity !== "pass"),
};

writeFileSync(OUT_FILE, JSON.stringify(summary, null, 2));

const critical = summary.counts.critical;
const high = summary.counts.high;

console.log(`\nVercel/Config Audit complete`);
console.log(`  Critical: ${critical}  High: ${high}  Medium: ${summary.counts.medium}  Low: ${summary.counts.low}`);
console.log(`  Results: ${OUT_FILE}`);

if (critical > 0 || high > 0) {
  console.error(`\nFAIL: ${critical} critical + ${high} high finding(s)`);
  process.exit(1);
}
