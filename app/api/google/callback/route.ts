import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { encrypt } from "../../../lib/crypto";
import { saveTokens } from "../../../lib/google-client";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const stateParam = request.nextUrl.searchParams.get("state");
  const returnTo = stateParam ? decodeURIComponent(stateParam) : "/finance";

  if (error) {
    return Response.redirect(new URL(`${returnTo}?google=denied`, request.url));
  }

  if (!code) {
    return Response.json({ error: "Missing authorisation code" }, { status: 400 });
  }

  try {
    // Exchange code for tokens using fetch (avoids googleapis HTTP client issues)
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
        redirect_uri: process.env.GOOGLE_REDIRECT_URI || "",
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error("Token exchange failed:", tokenRes.status, errBody);
      return Response.redirect(new URL("/finance?google=error", request.url));
    }

    const tokens = await tokenRes.json();

    // Get user email using the access token
    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userInfo = await userInfoRes.json();
    const email = userInfo.email || "unknown";

    const supabase = createServiceClient();

    if (tokens.refresh_token) {
      // Full token set — save everything (first auth or user re-consented)
      await saveTokens(email, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
        scope: tokens.scope,
      });
    } else {
      // Google didn't return a new refresh_token (already authorised).
      // Only update access_token + expiry; preserve the existing refresh_token.
      await supabase.from("google_oauth_tokens").upsert(
        {
          user_email: email,
          access_token: tokens.access_token ? encrypt(tokens.access_token) : "",
          token_expiry: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
          scopes: tokens.scope || "",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_email", ignoreDuplicates: false }
      );
    }

    return Response.redirect(new URL(`${returnTo}?google=connected`, request.url));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Google OAuth callback error:", message);
    return Response.redirect(new URL(`${returnTo}?google=error`, request.url));
  }
}
