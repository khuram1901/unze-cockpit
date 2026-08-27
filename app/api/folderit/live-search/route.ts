/**
 * GET /api/folderit/live-search?q=xxx
 *
 * Global document search across every Folderit cabinet the user can see.
 *
 * Searches the folderit_all_files index (refreshed every 30 minutes by
 * /api/folderit/sync-files) with ILIKE — instant and reliable. Previously
 * this called Folderit's own search API, which silently returned nothing
 * (Khuram: "the documents is there but search wont pick up").
 *
 * Access rules:
 *  - Member role → 403 (search not available)
 *  - Admin / CEO → all accounts
 *  - Everyone else → company-scoped visibility (Access Matrix ticks;
 *    HR tick → HR cabinet only). See lib/folderit-access.ts.
 */

import { NextRequest } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";
import { resolveFolderitAccess } from "../../../lib/folderit-access";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const email = (auth as { email: string }).email.toLowerCase();

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json({ items: [] });

  const db = createServiceClient();

  const access = await resolveFolderitAccess(db, email);

  // Members cannot use global search
  if (!access.isAdmin && access.role === "Member") {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }

  if (access.accountUids !== null && !access.accountUids.length) {
    return Response.json({ items: [] });
  }

  // Escape ILIKE wildcards in the user's query so "%"/"_" match literally
  const escaped = q.replace(/[%_\\]/g, (m) => `\\${m}`);

  let fileQuery = db
    .from("folderit_all_files")
    .select("file_uid, name, folder_path, account_uid, size_bytes, created_at_folderit")
    .ilike("name", `%${escaped}%`)
    .order("name")
    .limit(60);

  if (access.accountUids !== null) {
    fileQuery = fileQuery.in("account_uid", access.accountUids);
  }

  const [{ data: files, error }, { data: accountRows }] = await Promise.all([
    fileQuery,
    db
      .from("folderit_account_map")
      .select("account_uid, account_name")
      .eq("is_active", true),
  ]);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const accountNames = new Map((accountRows ?? []).map((a) => [a.account_uid, a.account_name]));

  const items = (files ?? []).map((f) => ({
    uid: f.file_uid,
    name: f.name,
    type: "file",
    account_uid: f.account_uid,
    account_name: accountNames.get(f.account_uid) ?? f.account_uid,
    folder_uid: null,
    folder_name: f.folder_path,
    created_at: f.created_at_folderit,
    folderit_url: `https://my.folderit.com/file/view/?uid=${f.file_uid}`,
  }));

  return Response.json({ items });
}
