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
 *    Every other /api/* route returns 403.
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

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only police API routes
  if (!pathname.startsWith("/api/")) return NextResponse.next();

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
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
