import { NextRequest } from "next/server";
import zlib from "zlib";
import { createServiceClient } from "../../../lib/supabase-server";
import { BACKUP_TABLES } from "../../../lib/backup-tables";
import { requireAuth } from "../../../lib/api-auth";

const BACKUPS_BUCKET = "backups";
const ADMIN_EMAIL = "khuram1901@gmail.com";

// Tables without a single "id" primary key need their natural/composite key
// for upsert conflict resolution. Mirrors the SPECIAL_DELETES map in
// /api/admin/wipe-data — keep both in sync if table schemas change.
const CONFLICT_COLUMNS: Record<string, string> = {
  meeting_tasks: "meeting_id,task_id",
};

type RestoreBody = {
  confirm?: string;
  filename?: string;     // restore from a file already in the "backups" Storage bucket
  backup?: Record<string, unknown[]>; // or restore from an inline backup JSON (e.g. an emailed attachment, decompressed client-side)
};

// Restores tables from a backup snapshot via upsert-by-id, so existing rows
// are overwritten with the backup's version and rows that no longer exist
// in the backup are left alone (never auto-deletes — a restore should never
// be more destructive than necessary). Run /api/admin/wipe-data first if a
// true clean-slate restore is needed.
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const isCronAuth = !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isCronAuth) {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;
    if (auth.email.toLowerCase() !== ADMIN_EMAIL) {
      return Response.json({ error: "Admin only" }, { status: 403 });
    }
  }

  const body = (await request.json().catch(() => ({}))) as RestoreBody;
  if (body.confirm !== "RESTORE_FROM_BACKUP") {
    return Response.json({ error: "Send { confirm: 'RESTORE_FROM_BACKUP' } to proceed" }, { status: 400 });
  }

  if (!body.filename && !body.backup) {
    return Response.json({ error: "Provide either { filename } (a backup in Storage) or { backup } (inline JSON)" }, { status: 400 });
  }

  const supabase = createServiceClient();
  let backup: Record<string, unknown[]>;

  try {
    if (body.backup) {
      backup = body.backup;
    } else {
      const { data, error } = await supabase.storage.from(BACKUPS_BUCKET).download(body.filename!);
      if (error || !data) {
        return Response.json({ error: `Could not download "${body.filename}": ${error?.message || "not found"}` }, { status: 404 });
      }
      const compressed = Buffer.from(await data.arrayBuffer());
      const decompressed = zlib.gunzipSync(compressed);
      backup = JSON.parse(decompressed.toString("utf8"));
    }
  } catch (e) {
    return Response.json({ error: `Failed to read backup: ${e instanceof Error ? e.message : "unknown error"}` }, { status: 400 });
  }

  const results: { table: string; status: string; restored?: number }[] = [];

  for (const table of BACKUP_TABLES) {
    const rows = backup[table];
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      results.push({ table, status: "skipped — no rows in backup" });
      continue;
    }

    try {
      // Chunk to avoid oversized single requests on large tables
      const CHUNK_SIZE = 500;
      let restored = 0;
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const { error, count } = await supabase
          .from(table)
          .upsert(chunk, { onConflict: CONFLICT_COLUMNS[table] || "id", count: "exact" });
        if (error) {
          results.push({ table, status: `error — ${error.message}`, restored });
          throw error;
        }
        restored += count ?? chunk.length;
      }
      results.push({ table, status: "restored", restored });
    } catch {
      continue;
    }
  }

  const restoredTables = results.filter((r) => r.status === "restored").length;
  const errorTables = results.filter((r) => r.status.startsWith("error")).length;
  const totalRows = results.reduce((s, r) => s + (r.restored || 0), 0);

  return Response.json({
    ok: errorTables === 0,
    restoredTables,
    errorTables,
    totalRows,
    results,
  });
}
