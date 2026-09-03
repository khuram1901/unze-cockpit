import type { NextConfig } from "next";

// ---------------------------------------------------------------------------
// Security headers applied to every response.
// Tighten the CSP incrementally: audit inline scripts and external sources,
// then remove 'unsafe-inline' / 'unsafe-eval' once nonces or hashes are in
// place. See docs/security/README.md §Headers and SECURITY_CHECKLIST.md §2.
// ---------------------------------------------------------------------------
const securityHeaders = [
  // Blocks the page from being embedded in an iframe on any other origin —
  // eliminates clickjacking. frame-ancestors in the CSP supersedes this in
  // modern browsers; both are set for compatibility with older user-agents.
  { key: "X-Frame-Options", value: "DENY" },

  // Forces browsers to use HTTPS for 2 years, including sub-domains, and
  // opts into the preload list. Vercel always serves over TLS. Remove
  // includeSubDomains only if you have HTTP-only sub-domains that must stay.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },

  // Prevents MIME-type sniffing — stops browsers re-interpreting a JSON or
  // text response as executable JavaScript via crafted Content-Type tricks.
  { key: "X-Content-Type-Options", value: "nosniff" },

  // Strips the full referrer URL when crossing origins so internal paths
  // (e.g. /finance/utpl?year=2025) are not leaked to third-party requests.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // Starter Content-Security-Policy.
  // Phase 1 (now): broad allowlist — blocks the worst attacks while the app
  //   continues to work unchanged.
  // Phase 2 (next quarter): audit inline scripts, add nonces or hashes, remove
  //   'unsafe-inline' and 'unsafe-eval'. Track in SECURITY_CHECKLIST.md §2.
  //
  // External connect targets used at runtime:
  //   *.supabase.co  — Supabase REST, Auth, Realtime (WebSocket)
  //   accounts.google.com — Google OAuth redirect target
  //   api.frankfurter.app, open.er-api.com — public FX rate APIs
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js needs unsafe-inline (inline styles, __NEXT_DATA__) and
      // unsafe-eval (dynamic imports in some builds). Revisit with nonces.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      // data: for inline images; blob: for PDF viewer; https: for avatar URLs
      "img-src 'self' data: blob: https:",
      [
        "connect-src 'self'",
        "https://*.supabase.co",
        "wss://*.supabase.co",
        "https://accounts.google.com",
        "https://api.frankfurter.app",
        "https://open.er-api.com",
      ].join(" "),
      "media-src 'none'",
      "object-src 'none'",
      "frame-src 'none'",
      // frame-ancestors supersedes X-Frame-Options in CSP-aware browsers.
      "frame-ancestors 'none'",
      "base-uri 'self'",
      // Allow form submissions only to this origin and Google OAuth.
      "form-action 'self' https://accounts.google.com",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],

  async headers() {
    return [
      {
        // Apply security headers to every route — HTML pages, API responses,
        // and Next.js internal routes.
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },

  async redirects() {
    return [
      {
        source: "/executive",
        destination: "/home",
        permanent: true, // 308 — /executive is removed for good
      },
    ];
  },
};

export default nextConfig;
