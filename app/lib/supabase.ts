import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

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
