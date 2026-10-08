/**
 * Next.js edge middleware — store-user API fence
 *
 * Enforces two rules for store users:
 *
 * 1. must_change_password gate
 *    If app_metadata.must_change_password === true, every API route except
 *    /api/auth/change-password returns 403 { error: "password_change_required" }.
 *    Page routes pass through so the client can redirect to /change-password.
 *
 * 2. Store-user API fence
 *    Store users (identified by email matching STORE_USER_RE OR
 *    app_metadata.store_user === true) may only call /api/daily-sales/*.
 *    Every other /api/* route returns 403, including genuine cron/webhook
 *    routes — store accounts have no business calling those.
 *
 * Token extraction: we try both the Authorization: Bearer header AND the
 * Supabase session cookie (for browser requests that omit the header).
 * The Supabase JS client on the browser sends the session via localStorage /
 * in-memory, but cookie-based SSR sessions (e.g. a server component request)
 * would arrive cookie-only; this middleware now handles both paths.
 *
 * We decode — but do NOT verify — the JWT here to read email and app_metadata.
 * Real JWT verification happens inside requireAuth() in each route handler;
 * this is defence-in-depth, not the primary auth gate.
 *
 * A forged JWT with a non-store email would still fail requireAuth() inside
 * the route, so the lack of crypto verification here is safe.
 */

import { NextRequest, NextResponse } from "next/server";

// Single source-of-truth regex — mirrors app/lib/useRouteGuard.ts
const STORE_USER_RE = /^store\d{3}@unze\.co\.uk$/i;

// Supabase project ref — used to find the session cookie
const SUPABASE_PROJECT_REF = "ffwdubfkcaoiyohscael";

interface JwtPayload {
  email?: string;
  app_metadata?: {
    store_user?: boolean;
    must_change_password?: boolean;
    [key: string]: unknown;
  };
}

/** Decode the payload of a JWT without verification (base64url → JSON). */
function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    // base64url → base64 → JSON
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Extract a Supabase access token from the request.
 * Tries, in order:
 *   1. Authorization: Bearer <token> header
 *   2. sb-<ref>-auth-token cookie (JSON: { access_token, refresh_token })
 *   3. Chunked cookie: sb-<ref>-auth-token.0 + .1 + … (Supabase SSR splits
 *      large tokens across multiple cookies)
 * Returns null when no usable token is found.
 */
function extractToken(req: NextRequest): string | null {
  // 1. Bearer header (used by authedFetch / apiFetch in all existing pages)
  const auth = req.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }

  // 2 & 3. Supabase session cookie (SSR / cookie-based sessions)
  const cookieName = `sb-${SUPABASE_PROJECT_REF}-auth-token`;

  // Try unchunked first
  const unchunked = req.cookies.get(cookieName)?.value ?? null;
  if (unchunked) {
    try {
      const parsed = JSON.parse(decodeURIComponent(unchunked)) as { access_token?: string };
      if (parsed.access_token) return parsed.access_token;
    } catch {
      // fall through to chunked attempt
    }
  }

  // Try chunked (Supabase SSR splits tokens across .0, .1, … cookies)
  let chunks = "";
  for (let i = 0; i < 6; i++) {
    const chunk = req.cookies.get(`${cookieName}.${i}`)?.value;
    if (!chunk) break;
    chunks += chunk;
  }
  if (chunks) {
    try {
      const parsed = JSON.parse(decodeURIComponent(chunks)) as { access_token?: string };
      if (parsed.access_token) return parsed.access_token;
    } catch {
      // malformed — treat as no token
    }
  }

  return null;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only police API routes
  if (!pathname.startsWith("/api/")) return NextResponse.next();

  const token = extractToken(req);
  if (!token) return NextResponse.next(); // no token → let requireAuth() handle 401

  const payload = decodeJwtPayload(token);
  if (!payload) return NextResponse.next();

  const email = payload.email ?? null;
  const appMeta = payload.app_metadata ?? {};

  // Determine if this is a store user — either by email pattern or app_metadata flag
  const isStoreUser =
    (email !== null && STORE_USER_RE.test(email)) ||
    appMeta.store_user === true;

  if (!isStoreUser) return NextResponse.next();

  // ── must_change_password gate ──────────────────────────────────────────────
  // Only /api/auth/change-password is allowed through until password is changed.
  if (appMeta.must_change_password === true) {
    if (pathname.startsWith("/api/auth/change-password")) {
      return NextResponse.next();
    }
    return NextResponse.json(
      { error: "password_change_required" },
      { status: 403 }
    );
  }

  // ── Store-user API fence ───────────────────────────────────────────────────
  // /api/daily-sales/* is the only API store users may call after password set.
  if (pathname.startsWith("/api/daily-sales/")) return NextResponse.next();

  return NextResponse.json(
    { error: "Forbidden: store accounts may only access /daily-sales" },
    { status: 403 }
  );
}

export const config = {
  matcher: ["/api/:path*"],
};
