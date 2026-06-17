import { google } from "googleapis";
import { createServiceClient } from "./supabase-server";

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
  const { data, error } = await supabase
    .from("google_oauth_tokens")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error("No Google OAuth tokens found. Please connect your Gmail first.");
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: data.token_expiry ? new Date(data.token_expiry).getTime() : undefined,
  });

  oauth2Client.on("tokens", async (newTokens) => {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (newTokens.access_token) updates.access_token = newTokens.access_token;
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
      access_token: tokens.access_token || "",
      refresh_token: tokens.refresh_token || "",
      token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      scopes: tokens.scope || SCOPES.join(" "),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_email" }
  );
}
