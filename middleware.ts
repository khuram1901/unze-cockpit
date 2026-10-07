/**
 * Next.js edge middleware — store-user API fence
 *
 * Store users (store\d{3}@unze.co.uk) may ONLY access /api/daily-sales/*.
 * Every other /api/* route returns 403 for them before the route handler
 * ever runs.  The real JWT verification still happens inside requireAuth()
 * on each route; this is an additional defence-in-depth layer.
 *
 * We decode — but do NOT verify — the JWT here to read the email claim.
 * Verification is not needed because requireAuth() does it; forging a JWT
 * with a non-store email would still fail requireAuth() in the route.
 */

import { NextRequest, NextResponse } from "next/server";

// Single source-of-truth regex — mirrors app/lib/useRouteGuard.ts
const STORE_USER_RE = /^store\d{3}@unze\.co\.uk$/i;

/** Decode the payload of a JWT without verification (base64url → JSON). */
function jwtEmail(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    // base64url → base64 → JSON
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const parsed = JSON.parse(json) as Record<string, unknown>;
    // Supabase embeds the email under "email" at root level
    return typeof parsed.email === "string" ? parsed.email : null;
  } catch {
    return null;
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only police API routes
  if (!pathname.startsWith("/api/")) return NextResponse.next();

  // /api/daily-sales/* is the only API store users may call
  if (pathname.startsWith("/api/daily-sales/")) return NextResponse.next();

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.next(); // no token → let requireAuth() handle 401

  const email = jwtEmail(token);
  if (email && STORE_USER_RE.test(email)) {
    return NextResponse.json(
      { error: "Forbidden: store accounts may only access /daily-sales" },
      { status: 403 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
