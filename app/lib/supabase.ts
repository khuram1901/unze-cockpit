import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Explicit auth config — persists the session to localStorage so users stay
// signed in across browser restarts until the refresh token expires.
// Refresh token lifetime is set in Supabase Dashboard → Auth → Configuration.
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession:     true,
    autoRefreshToken:   true,
    detectSessionInUrl: true,
  },
});

// Returns the current session, proactively refreshing it when the access
// token is expired or about to expire. getSession() alone hands back the
// CACHED token — after a laptop sleeps or a tab sits in the background the
// auto-refresh timer has stalled, so the first clicks fire with an expired
// JWT ("JWT expired" on every page until logout/login). This closes that gap.
let refreshInFlight: Promise<void> | null = null;
export async function ensureFreshSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const expiresAtMs = (session.expires_at ?? 0) * 1000;
  if (expiresAtMs - Date.now() > 60_000) return session; // still fresh
  // Deduplicate concurrent refreshes (several fetches can race on wake).
  if (!refreshInFlight) {
    refreshInFlight = supabase.auth
      .refreshSession()
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => { refreshInFlight = null; });
  }
  await refreshInFlight;
  const { data: { session: fresh } } = await supabase.auth.getSession();
  // Only hand back a session that is actually usable. If the refresh failed
  // (dead refresh token, network error) the re-fetched session is either
  // gone or still expired — returning the stale one here would defeat the
  // caller's "no session → go to login" handling with a token that 401s.
  if (!fresh) return null;
  const freshExpiresMs = (fresh.expires_at ?? 0) * 1000;
  return freshExpiresMs - Date.now() > 0 ? fresh : null;
}

// Lets callers that are about to sign out wait for any in-flight token
// refresh to settle first — otherwise a refresh response landing after
// signOut() can write a new session back into storage and silently undo a
// security logout.
export function pendingSessionRefresh(): Promise<void> {
  return refreshInFlight ?? Promise.resolve();
}

export async function authHeaders(): Promise<Record<string, string>> {
  const session = await ensureFreshSession();
  if (!session?.access_token) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}

export async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const ah = await authHeaders();
  return fetch(url, {
    ...init,
    headers: { ...ah, ...init?.headers },
  });
}

export async function loadMyPermissions(token?: string): Promise<Record<string, unknown> | null> {
  try {
    let accessToken = token;
    if (!accessToken) {
      const session = await ensureFreshSession();
      accessToken = session?.access_token || undefined;
    }
    if (!accessToken) return null;
    const res = await fetch("/api/me/permissions", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.overrides || null;
  } catch {
    return null;
  }
}

export async function loadMyWidgetOverrides(token?: string): Promise<Record<string, boolean> | null> {
  try {
    let accessToken = token;
    if (!accessToken) {
      const session = await ensureFreshSession();
      accessToken = session?.access_token || undefined;
    }
    if (!accessToken) return null;
    const res = await fetch("/api/me/widgets", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.overrides || null;
  } catch {
    return null;
  }
}
