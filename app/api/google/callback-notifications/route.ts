import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { encrypt } from "../../../lib/crypto";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    return Response.redirect(new URL("/finance?notif=denied", request.url));
  }

  if (!code) {
    return Response.json({ error: "Missing authorisation code" }, { status: 400 });
  }

  try {
    const redirectUri = (process.env.GOOGLE_REDIRECT_URI || "").replace("/callback", "/callback-notifications");

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error("Notification token exchange failed:", tokenRes.status, errBody);
      return Response.redirect(new URL("/finance?notif=error", request.url));
    }

    const tokens = await tokenRes.json();

    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userInfo = await userInfoRes.json();
    const email = userInfo.email || "unknown";

    const supabase = createServiceClient();

    if (tokens.refresh_token) {
      // Full token set — save everything
      await supabase.from("google_oauth_tokens").upsert(
        {
          user_email: email,
          access_token: tokens.access_token ? encrypt(tokens.access_token) : "",
          refresh_token: encrypt(tokens.refresh_token),
          token_expiry: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
          scopes: tokens.scope || "gmail.send",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_email" }
      );
    } else {
      // Google didn't return a new refresh_token — only update access_token + expiry
      await supabase.from("google_oauth_tokens").upsert(
        {
          user_email: email,
          access_token: tokens.access_token ? encrypt(tokens.access_token) : "",
          token_expiry: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
          scopes: tokens.scope || "gmail.send",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_email", ignoreDuplicates: false }
      );
    }

    return Response.redirect(new URL("/finance?notif=connected", request.url));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Notification OAuth callback error:", message);
    return Response.redirect(new URL("/finance?notif=error", request.url));
  }
}
