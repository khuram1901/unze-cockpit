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

export async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
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
      const { data: { session } } = await supabase.auth.getSession();
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
      const { data: { session } } = await supabase.auth.getSession();
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
