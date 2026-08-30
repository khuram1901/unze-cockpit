/**
 * GET /api/folderit/all-files?account_uid=xxx
 *
 * Returns a FLAT list of every file in a cabinet — no folder-by-folder
 * clicking. Khuram: "i want you to build the feature where i can view any
 * files from any of the cabinets."
 *
 * Fast path: reads the folderit_all_files index (refreshed every 30 min
 * by the sync-files cron). If the index is empty for this account (e.g.
 * the cron hasn't run yet after deploy), falls back to walking the
 * cabinet live via lib/folderit-walk.
 *
 * Access is checked with the same resolver as every other Folderit route.
 */

import { NextRequest } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";
import { resolveFolderitAccess } from "../../../lib/folderit-access";
import { listCabinetFiles } from "../../../lib/folderit-walk";

export const runtime = "nodejs";
export const maxDuration = 60; // live-walk fallback can take a while on big cabinets

function fileUrl(uid: string): string {
  return `https://my.folderit.com/file/view/?uid=${uid}`;
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const email = (auth as { email: string }).email.toLowerCase();

  const accountUid = request.nextUrl.searchParams.get("account_uid");
  if (!accountUid) return Response.json({ error: "account_uid required" }, { status: 400 });

  const db = createServiceClient();
  const access = await resolveFolderitAccess(db, email);

  if (access.accountUids !== null && !access.accountUids.includes(accountUid)) {
    return Response.json({ error: "You do not have access to this Folderit account" }, { status: 403 });
  }

  try {
    // Fast path: the synced index
    const { data: indexed, error } = await db
      .from("folderit_all_files")
      .select("file_uid, name, folder_path, size_bytes, created_at_folderit")
      .eq("account_uid", accountUid)
      .order("name")
      .limit(8000);

    if (!error && indexed && indexed.length > 0) {
      return Response.json({
        files: indexed.map((f) => ({
          uid: f.file_uid,
          name: f.name,
          folder_path: f.folder_path,
          size: f.size_bytes,
          createdAt: f.created_at_folderit
            ? Math.floor(new Date(f.created_at_folderit).getTime() / 1000)
            : null,
          folderit_url: fileUrl(f.file_uid),
        })),
        total: indexed.length,
        truncated: indexed.length === 8000,
        source: "index",
      });
    }

    // Fallback: live walk (index not yet populated for this cabinet).
    // 50s deadline keeps us inside the function's 60s ceiling.
    const { files, truncated, source } = await listCabinetFiles(accountUid, Date.now() + 50_000);
    files.sort((a, b) => a.name.localeCompare(b.name));
    return Response.json({
      files: files.map((f) => ({ ...f, folderit_url: fileUrl(f.uid) })),
      total: files.length,
      truncated,
      source,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to list files" },
      { status: 500 }
    );
  }
}
