/**
 * GET /api/folderit/live-search?q=xxx
 *
 * Searches Folderit documents by calling Folderit's own search API.
 *
 * Access rules:
 *  - Member role → 403 (search not available)
 *  - Admin / CEO → all accounts
 *  - Manager / Executive (and any other non-Member role) → only accounts
 *    they are explicitly mapped to in folderit_user_map. This ensures
 *    they can only discover filenames in cabinets Folderit has granted
 *    them access to, not every cabinet linked to their company.
 *
 * Returns up to 10 results per account, max 60 total, each with a direct
 * Folderit URL so the user can open the document in one click.
 */

import { NextRequest } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";
import { folderitFetch } from "../../../lib/folderit-auth";

export const runtime = "nodejs";

type FolderitSearchHit = {
  uid?: string;
  name?: string;
  type?: string;        // "file" | "folder"
  folderUid?: string;  // parent folder uid
  folderName?: string;
  createdAt?: number;
  size?: number;
};

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const email = (auth as { email: string }).email.toLowerCase();

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json({ items: [] });

  const db = createServiceClient();

  const { data: member } = await db
    .from("members")
    .select("role, company_id")
    .eq("email", email)
    .maybeSingle();

  const role = member?.role ?? null;

  const isAdmin =
    email === "khuram1901@gmail.com" ||
    role === "Admin" ||
    role === "CEO";

  // Members cannot use global search
  if (!isAdmin && role === "Member") {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }

  let accountsToSearch: { account_uid: string; account_name: string }[] = [];

  if (isAdmin) {
    // Admin / CEO — search all active accounts
    const { data } = await db
      .from("folderit_account_map")
      .select("account_uid, account_name")
      .eq("is_active", true)
      .neq("scope", "excluded")
      .neq("scope", "pending");
    accountsToSearch = data ?? [];
  } else {
    // Manager / Executive etc. — restrict to accounts they are explicitly
    // mapped to in folderit_user_map (i.e. Folderit has granted them access).
    const { data: mappings } = await db
      .from("folderit_user_map")
      .select("account_uid")
      .eq("member_email", email);

    const mappedUids = (mappings ?? []).map((m: { account_uid: string }) => m.account_uid);
    if (!mappedUids.length) return Response.json({ items: [] });

    const { data } = await db
      .from("folderit_account_map")
      .select("account_uid, account_name")
      .eq("is_active", true)
      .neq("scope", "excluded")
      .neq("scope", "pending")
      .in("account_uid", mappedUids);
    accountsToSearch = data ?? [];
  }

  if (!accountsToSearch.length) return Response.json({ items: [] });

  // Search Folderit for each account in parallel
  const perAccount = await Promise.all(
    accountsToSearch.map(async (account) => {
      try {
        const res = await folderitFetch(
          `/v2/accounts/${account.account_uid}/search?query=${encodeURIComponent(q)}&per-page=10`
        );
        if (!res.ok) return [];
        const json = await res.json();
        const hits: FolderitSearchHit[] = json?.files ?? json?.results ?? json?.items ?? json ?? [];
        return hits
          .filter((h) => h.uid && h.name)
          .map((h) => ({
            uid: h.uid!,
            name: h.name!,
            type: h.type ?? "file",
            account_uid: account.account_uid,
            account_name: account.account_name,
            folder_uid: h.folderUid ?? null,
            folder_name: h.folderName ?? null,
            created_at: h.createdAt ? new Date(h.createdAt * 1000).toISOString() : null,
            folderit_url: h.type === "folder"
              ? `https://my.folderit.com/folder/index/?uid=${h.uid}`
              : `https://my.folderit.com/file/view/?uid=${h.uid}`,
          }));
      } catch {
        return [];
      }
    })
  );

  const items = perAccount
    .flat()
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 60);

  return Response.json({ items });
}
