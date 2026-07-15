import { google } from "googleapis";
import { createServiceClient } from "./supabase-server";
import { encrypt, safeDecrypt } from "./crypto";
import { GOOGLE_INTEGRATION_EMAIL } from "./constants";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl(): string {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
}

export async function exchangeCodeForTokens(code: string) {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

export async function getAuthenticatedClient() {
  const supabase = createServiceClient();
  // Found during the 15 Jul 2026 full-app audit: this used to grab
  // whichever token row was most recently saved, with no email filter —
  // so anyone who completed their own Google consent screen against
  // /api/google/callback would silently become the account the whole
  // app's Gmail/Calendar/Drive integration ran as. Now pinned to the one
  // account this integration is actually meant to be.
  const { data, error } = await supabase
    .from("google_oauth_tokens")
    .select("*")
    .eq("user_email", GOOGLE_INTEGRATION_EMAIL)
    .single();

  if (error || !data) {
    throw new Error(`No Google OAuth tokens found for ${GOOGLE_INTEGRATION_EMAIL}. Please connect Google on the Calendar page first.`);
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: safeDecrypt(data.access_token),
    refresh_token: safeDecrypt(data.refresh_token),
    expiry_date: data.token_expiry ? new Date(data.token_expiry).getTime() : undefined,
  });

  oauth2Client.on("tokens", async (newTokens) => {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (newTokens.access_token) updates.access_token = encrypt(newTokens.access_token);
    if (newTokens.expiry_date) updates.token_expiry = new Date(newTokens.expiry_date).toISOString();
    await supabase
      .from("google_oauth_tokens")
      .update(updates)
      .eq("id", data.id);
  });

  return oauth2Client;
}

export async function saveTokens(
  email: string,
  tokens: { access_token?: string | null; refresh_token?: string | null; expiry_date?: number | null; scope?: string | null }
) {
  const supabase = createServiceClient();
  await supabase.from("google_oauth_tokens").upsert(
    {
      user_email: email,
      access_token: tokens.access_token ? encrypt(tokens.access_token) : "",
      refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : "",
      token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      scopes: tokens.scope || SCOPES.join(" "),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_email" }
  );
}
