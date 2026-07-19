import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { folderitFetch } from "../../../lib/folderit-auth";

// Folder/file browser for the Folderit Browse tab.
//
// GET /api/folderit/browse?account_uid=xxx
//   → Root: calls /access for the user's accessible folders (requires
//     a folderit_user_map entry). Admins without a mapping get an empty
//     root with a "sync pending" note.
//
// GET /api/folderit/browse?account_uid=xxx&folder_uid=yyy
//   → Drill-in: lists subfolders + files inside yyy.
//
// All browsing is view-only. Files are identified by UID; the caller
// fetches a download/preview URL separately via /api/folderit/file-url.

type FolderitRawItem = {
  uid: string;
  name?: string;
  createdAt?: number;
  size?: number;
};

// Possible shapes Folderit uses for /access responses
type AccessItem = {
  uid?: string;
  entityUid?: string;
  type?: string;
  entityType?: string;
  name?: string;
  entityName?: string;
  path?: string;
};

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const email = (auth as { email: string }).email.toLowerCase();

  const { searchParams } = new URL(request.url);
  const accountUid = searchParams.get("account_uid");
  const folderUid = searchParams.get("folder_uid");

  if (!accountUid) {
    return Response.json({ error: "account_uid required" }, { status: 400 });
  }

  const db = createServiceClient();

  const { data: member } = await db
    .from("members")
    .select("role")
    .eq("email", email)
    .maybeSingle();

  const isAdmin =
    email === "khuram1901@gmail.com" ||
    member?.role === "Admin" ||
    member?.role === "CEO";

  // Look up the user's Folderit UID for this account
  const { data: mapping } = await db
    .from("folderit_user_map")
    .select("folderit_user_uid")
    .eq("member_email", email)
    .eq("account_uid", accountUid)
    .maybeSingle();

  // Non-admins must have a mapping to browse this account
  if (!isAdmin && !mapping) {
    return Response.json(
      { error: "You do not have access to this Folderit account" },
      { status: 403 }
    );
  }

  try {
    // ── Drill into a specific folder ──────────────────────────────────
    if (folderUid) {
      const [foldersRes, filesRes] = await Promise.all([
        folderitFetch(`/v2/accounts/${accountUid}/folders/${folderUid}/folders?per-page=500`),
        folderitFetch(`/v2/accounts/${accountUid}/folders/${folderUid}/files?per-page=500`),
      ]);

      const foldersJson = foldersRes.ok ? await foldersRes.json() : null;
      const filesJson = filesRes.ok ? await filesRes.json() : null;

      const folders: FolderitRawItem[] = foldersJson?.folders ?? foldersJson ?? [];
      const files: FolderitRawItem[] = filesJson?.files ?? filesJson ?? [];

      return Response.json({
        folders: folders.map((f) => ({ uid: f.uid, name: f.name ?? f.uid })),
        files: files.map((f) => ({
          uid: f.uid,
          name: f.name ?? f.uid,
          createdAt: f.createdAt ?? null,
          size: f.size ?? null,
        })),
      });
    }

    // ── Root: list folders the user can see ──────────────────────────
    //
    // Admins use the root folders endpoint directly — it returns real folder
    // names. The /access endpoint (used for non-admins) only returns UIDs for
    // the account owner, so folder names would show as unreadable codes.
    //
    // Non-admins use /access so Folderit enforces their permissions.
    if (isAdmin) {
      const rootRes = await folderitFetch(
        `/v2/accounts/${accountUid}/folders?per-page=500`
      );
      if (!rootRes.ok) {
        const body = await rootRes.text().catch(() => "");
        return Response.json(
          { error: `Folderit /folders returned ${rootRes.status}: ${body}` },
          { status: 502 }
        );
      }
      const rootJson = await rootRes.json();
      const rootFolders: FolderitRawItem[] = rootJson?.folders ?? rootJson ?? [];
      return Response.json({
        folders: rootFolders.map((f) => ({ uid: f.uid, name: f.name ?? f.uid })),
        files: [],
      });
    }

    if (!mapping) {
      return Response.json({
        folders: [],
        files: [],
        note: "User not yet mapped to this Folderit account. Run the sync cron to populate.",
      });
    }

    const accessRes = await folderitFetch(
      `/v2/accounts/${accountUid}/users/${mapping.folderit_user_uid}/access`
    );

    if (!accessRes.ok) {
      const body = await accessRes.text().catch(() => "");
      return Response.json(
        { error: `Folderit /access returned ${accessRes.status}: ${body}` },
        { status: 502 }
      );
    }

    const accessJson = await accessRes.json();
    const raw: AccessItem[] = accessJson?.items ?? accessJson?.shares ?? accessJson ?? [];

    const folders = raw
      .filter((item) => {
        const t = item.type ?? item.entityType ?? "";
        return t === "folder" || t === "" || t === undefined;
      })
      .map((item) => ({
        uid: (item.uid ?? item.entityUid ?? "") as string,
        name: (item.name ?? item.entityName ?? item.path ?? item.uid ?? item.entityUid ?? "") as string,
      }))
      .filter((f) => f.uid);

    return Response.json({ folders, files: [] });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Browse failed" },
      { status: 500 }
    );
  }
}
