/**
 * GET /api/folderit/sync-files — cron, every 10 minutes.
 *
 * Indexes ONE cabinet per run into folderit_all_files — the one whose
 * index is stalest (never-indexed cabinets first). With 7 cabinets and a
 * 10-minute cadence, every cabinet refreshes roughly hourly.
 *
 * Why one at a time: walking all 7 cabinets in a single invocation blew
 * straight through the 60s serverless ceiling (FUNCTION_INVOCATION_TIMEOUT,
 * 30/08/2026). Each run now has a 45s walk deadline — whatever is
 * collected by then still gets indexed, and the next run continues with
 * the next-stalest cabinet.
 *
 * ?account_uid=xxx forces a specific cabinet (handy for manual runs).
 *
 * This index powers global search (ILIKE) and the Browse tab's
 * "All Files" flat view.
 *
 * Auth: Bearer CRON_SECRET — same pattern as /sync.
 */

import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { listCabinetFiles } from "../../../lib/folderit-walk";

export const runtime = "nodejs";
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;
const WALK_BUDGET_MS = 45_000;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();

  const forcedAccount = request.nextUrl.searchParams.get("account_uid");

  const [{ data: accounts }, { data: freshness }] = await Promise.all([
    db
      .from("folderit_account_map")
      .select("account_uid, account_name")
      .eq("is_active", true)
      .neq("scope", "excluded")
      .neq("scope", "pending"),
    db
      .from("folderit_all_files")
      .select("account_uid, synced_at")
      .order("synced_at", { ascending: false }),
  ]);

  if (!accounts?.length) {
    return Response.json({ ok: true, version: 3, indexed: null, files: 0 });
  }

  // Newest synced_at per account (first occurrence wins — rows are sorted desc)
  const lastSynced = new Map<string, string>();
  for (const row of freshness ?? []) {
    if (!lastSynced.has(row.account_uid)) lastSynced.set(row.account_uid, row.synced_at);
  }

  // Pick the target: forced > never-indexed > stalest
  let target = forcedAccount
    ? accounts.find((a) => a.account_uid === forcedAccount)
    : undefined;
  if (forcedAccount && !target) {
    return Response.json({ error: "Unknown account_uid" }, { status: 400 });
  }
  if (!target) {
    const sorted = [...accounts].sort((a, b) => {
      const ta = lastSynced.get(a.account_uid) ?? "";
      const tb = lastSynced.get(b.account_uid) ?? "";
      return ta.localeCompare(tb); // "" (never indexed) sorts first
    });
    target = sorted[0];
  }

  try {
    const deadline = Date.now() + WALK_BUDGET_MS;
    const { files, truncated, source } = await listCabinetFiles(target.account_uid, deadline);

    // Wholesale replace this account's rows
    await db.from("folderit_all_files").delete().eq("account_uid", target.account_uid);

    for (let i = 0; i < files.length; i += 500) {
      const chunk = files.slice(i, i + 500).map((f) => ({
        account_uid: target.account_uid,
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

    return Response.json({
      ok: true,
      version: 3,
      indexed: target.account_name,
      files: files.length,
      truncated,
      source,
      staleness: accounts.map((a) => ({
        name: a.account_name,
        lastIndexed: a.account_uid === target!.account_uid ? "just now" : (lastSynced.get(a.account_uid) ?? "never"),
      })),
    });
  } catch (e) {
    return Response.json({
      ok: false,
      version: 3,
      indexed: target.account_name,
      error: e instanceof Error ? e.message : "failed",
    }, { status: 500 });
  }
}
