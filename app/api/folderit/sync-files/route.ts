/**
 * GET /api/folderit/sync-files — cron, every 30 minutes.
 *
 * Indexes EVERY file in every active Folderit cabinet into
 * folderit_all_files (wholesale replace per account). This powers:
 *  - Global search (ILIKE on the table — instant, reliable; Folderit's
 *    own search API was silently returning nothing)
 *  - The Browse tab's "All Files" flat view
 *
 * Auth: Bearer CRON_SECRET (Vercel cron) — same pattern as /sync.
 */

import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { listCabinetFiles } from "../../../lib/folderit-walk";

export const runtime = "nodejs";
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();

  const { data: accounts } = await db
    .from("folderit_account_map")
    .select("account_uid, account_name")
    .eq("is_active", true)
    .neq("scope", "excluded")
    .neq("scope", "pending");

  if (!accounts?.length) {
    return Response.json({ ok: true, accounts: 0, filesIndexed: 0 });
  }

  let totalFiles = 0;
  const errors: string[] = [];
  const perAccount: { name: string; files: number; source: string }[] = [];

  // Walk all cabinets in parallel — each is independently capped, and a
  // failure in one cabinet never blocks the others.
  await Promise.all(
    accounts.map(async (account) => {
      try {
        const { files, source } = await listCabinetFiles(account.account_uid);
        perAccount.push({ name: account.account_name, files: files.length, source });

        // Wholesale replace this account's rows
        await db.from("folderit_all_files").delete().eq("account_uid", account.account_uid);

        // Insert in chunks (Supabase caps request sizes)
        for (let i = 0; i < files.length; i += 500) {
          const chunk = files.slice(i, i + 500).map((f) => ({
            account_uid: account.account_uid,
            file_uid: f.uid,
            name: f.name,
            folder_path: f.folder_path,
            size_bytes: f.size,
            created_at_folderit: f.createdAt ? new Date(f.createdAt * 1000).toISOString() : null,
          }));
          const { error } = await db
            .from("folderit_all_files")
            .upsert(chunk, { onConflict: "file_uid" });
          if (error) throw new Error(error.message);
        }
        totalFiles += files.length;
      } catch (e) {
        errors.push(`${account.account_name}: ${e instanceof Error ? e.message : "failed"}`);
      }
    })
  );

  // Note the run on the most recent sync log row (best-effort)
  const { data: lastLog } = await db
    .from("folderit_sync_log")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastLog?.id) {
    await db.from("folderit_sync_log").update({ all_files_synced: totalFiles }).eq("id", lastLog.id);
  }

  return Response.json({
    ok: errors.length === 0,
    version: 2, // bump when sync logic changes — confirms which deploy served the request
    accounts: accounts.length,
    filesIndexed: totalFiles,
    perAccount,
    errors,
  });
}
