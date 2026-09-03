// PUBLIC ROUTE — intentionally unauthenticated at the HTTP level.
// This endpoint initiates the Google OAuth 2.0 consent flow by
// redirecting the browser to accounts.google.com. It is linked from
// the authenticated Profile page (profile/page.tsx) but the browser
// navigation cannot carry an Authorization header, so requireAuth()
// cannot be used here without middleware cookie-based session support.
//
// Security: the callback (google/callback) enforces that only
// GOOGLE_INTEGRATION_EMAIL may complete the flow — any other account
// is rejected before a token is stored. An unauthenticated request
// here can only redirect the browser to Google's consent screen; it
// cannot store credentials or affect application state.

import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const returnTo = request.nextUrl.searchParams.get("returnTo") || "/finance";

  const scopes = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/drive",
  ];

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: process.env.GOOGLE_REDIRECT_URI || "",
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    state: encodeURIComponent(returnTo),
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return Response.redirect(url);
}
