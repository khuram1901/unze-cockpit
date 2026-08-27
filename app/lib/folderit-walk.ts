/**
 * Shared Folderit cabinet walker.
 *
 * Lists every file in a cabinet. Tries the bulk entities/all endpoint
 * first (one call for the whole cabinet); falls back to a breadth-first
 * walk of the folder tree via the known-good /folders + /files endpoints
 * with bounded concurrency.
 *
 * Used by:
 *  - /api/folderit/sync-files  (cron — indexes every cabinet into
 *    folderit_all_files every 30 minutes)
 *  - /api/folderit/all-files   (on-demand fallback when the index is
 *    empty for an account)
 */

import { folderitFetch } from "./folderit-auth";

const MAX_FILES = 8000;      // per cabinet
const MAX_FOLDERS = 800;     // per cabinet
const WALK_CONCURRENCY = 6;

export type WalkedFile = {
  uid: string;
  name: string;
  folder_path: string | null;
  size: number | null;
  createdAt: number | null; // unix seconds (Folderit convention)
};

type RawEntity = {
  uid?: string;
  name?: string;
  type?: string;
  entityType?: string;
  folderUid?: string;
  parentUid?: string;
  path?: string;
  folderPath?: string;
  size?: number;
  createdAt?: number;
};

// ── Attempt 1: bulk entities/all ──────────────────────────────────────────
async function tryEntitiesAll(accountUid: string): Promise<WalkedFile[] | null> {
  try {
    const res = await folderitFetch(`/v2/accounts/${accountUid}/entities/all`);
    if (!res.ok) return null;
    const json = await res.json();
    const raw: RawEntity[] = Array.isArray(json)
      ? json
      : json?.entities ?? json?.items ?? json?.files ?? null;
    if (!Array.isArray(raw) || !raw.length) return null;

    const folderNames = new Map<string, string>();
    for (const e of raw) {
      const t = e.type ?? e.entityType ?? "";
      if (t === "folder" && e.uid && e.name) folderNames.set(e.uid, e.name);
    }

    const files = raw
      .filter((e) => {
        const t = e.type ?? e.entityType ?? "";
        return t !== "folder" && e.uid && e.name;
      })
      .map((e) => ({
        uid: e.uid!,
        name: e.name!,
        folder_path:
          e.path ??
          e.folderPath ??
          (e.folderUid ? folderNames.get(e.folderUid) ?? null : null) ??
          (e.parentUid ? folderNames.get(e.parentUid) ?? null : null),
        size: e.size ?? null,
        createdAt: e.createdAt ?? null,
      }));

    return files.length ? files : null;
  } catch {
    return null;
  }
}

// ── Attempt 2: breadth-first walk ─────────────────────────────────────────
async function walkTree(accountUid: string): Promise<{ files: WalkedFile[]; truncated: boolean }> {
  const files: WalkedFile[] = [];
  let truncated = false;

  type QueueItem = { folderUid: string | null; path: string };
  const queue: QueueItem[] = [{ folderUid: null, path: "" }];
  let foldersVisited = 0;

  async function processItem(item: QueueItem): Promise<QueueItem[]> {
    const base = item.folderUid
      ? `/v2/accounts/${accountUid}/folders/${item.folderUid}`
      : `/v2/accounts/${accountUid}`;

    const [foldersRes, filesRes] = await Promise.all([
      folderitFetch(`${base}/folders?per-page=500`),
      folderitFetch(`${base}/files?per-page=500`),
    ]);

    const foldersJson = foldersRes.ok ? await foldersRes.json().catch(() => null) : null;
    const filesJson = filesRes.ok ? await filesRes.json().catch(() => null) : null;

    const subFolders: RawEntity[] = foldersJson?.folders ?? (Array.isArray(foldersJson) ? foldersJson : []);
    const folderFiles: RawEntity[] = filesJson?.files ?? (Array.isArray(filesJson) ? filesJson : []);

    for (const f of folderFiles) {
      if (!f.uid || !f.name) continue;
      if (files.length >= MAX_FILES) { truncated = true; break; }
      files.push({
        uid: f.uid,
        name: f.name,
        folder_path: item.path || null,
        size: f.size ?? null,
        createdAt: f.createdAt ?? null,
      });
    }

    return subFolders
      .filter((f) => f.uid)
      .map((f) => ({
        folderUid: f.uid!,
        path: item.path ? `${item.path} / ${f.name ?? f.uid}` : (f.name ?? f.uid!),
      }));
  }

  while (queue.length && !truncated) {
    if (foldersVisited >= MAX_FOLDERS) { truncated = true; break; }
    const batch = queue.splice(0, WALK_CONCURRENCY);
    foldersVisited += batch.length;
    const results = await Promise.all(batch.map((i) => processItem(i).catch(() => [] as QueueItem[])));
    for (const children of results) queue.push(...children);
  }

  return { files, truncated };
}

export async function listCabinetFiles(accountUid: string): Promise<{ files: WalkedFile[]; truncated: boolean; source: "bulk" | "walk" }> {
  const bulk = await tryEntitiesAll(accountUid);
  if (bulk) {
    return {
      files: bulk.slice(0, MAX_FILES),
      truncated: bulk.length > MAX_FILES,
      source: "bulk",
    };
  }
  const walked = await walkTree(accountUid);
  return { ...walked, source: "walk" };
}
