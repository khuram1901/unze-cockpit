import { NextRequest } from "next/server";
import { saveTokens } from "../../../lib/google-client";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    return Response.redirect(new URL("/finance?google=denied", request.url));
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

    await saveTokens(email, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
      scope: tokens.scope,
    });

    return Response.redirect(new URL("/finance?google=connected", request.url));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Google OAuth callback error:", message);
    return Response.redirect(new URL("/finance?google=error", request.url));
  }
}
