/**
 * POST /api/admin/cleanup-source-docs
 * ─────────────────────────────────────────────────────────────────
 * Deletes duplicate files from the source-documents Storage bucket.
 * Root cause: document-archive.ts used Date.now() as a path prefix,
 * so every Gmail cron run created a new file for the same PDF.
 *
 * Strategy: keep the LATEST file per (doc_type, company_id, date_folder).
 * Delete everything else in batches of 200.
 *
 * Access: Admin only. One-time cleanup — safe to run multiple times
 * (already-deleted files return a storage 404 which is ignored).
 *
 * Query param: ?batch=N   process up to N×200 files (default 1 batch = 200).
 *              Pass ?batch=all to keep going until done.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";

const BUCKET = "source-documents";
const BATCH_SIZE = 200;

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const db = createServiceClient();

  // Admin-only guard
  const { data: member } = await db
    .from("members")
    .select("role")
    .eq("email", auth.email)
    .maybeSingle();
  if (member?.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const batchParam = url.searchParams.get("batch") ?? "1";
  const maxBatches = batchParam === "all" ? Infinity : parseInt(batchParam, 10) || 1;

  let totalDeleted = 0;
  let totalErrors = 0;
  let batchCount = 0;
  let keepGoing = true;

  while (keepGoing && batchCount < maxBatches) {
    // Find duplicate paths: all but the newest per (doc_type/company_id/date_folder)
    // Path structure: {doc_type}/{company_id}/{date}/{filename}.pdf
    const { data: dupes, error: queryErr } = await db.rpc(
      "find_source_doc_duplicates",
      { p_limit: BATCH_SIZE }
    );

    if (queryErr) {
      return NextResponse.json({ error: queryErr.message, deleted: totalDeleted }, { status: 500 });
    }

    if (!dupes || dupes.length === 0) {
      keepGoing = false;
      break;
    }

    const paths: string[] = dupes.map((r: { name: string }) => r.name);
    const { error: delErr } = await db.storage.from(BUCKET).remove(paths);

    if (delErr) {
      // Storage errors are soft — log and continue
      totalErrors++;
      console.error("cleanup-source-docs storage remove error:", delErr.message);
    } else {
      totalDeleted += paths.length;
    }

    if (paths.length < BATCH_SIZE) keepGoing = false;
    batchCount++;
  }

  // After cleanup, count remaining files
  const { count } = await db
    .from("storage.objects")
    .select("*", { count: "exact", head: true })
    .eq("bucket_id", BUCKET);

  return NextResponse.json({
    ok: true,
    deleted: totalDeleted,
    batches: batchCount,
    errors: totalErrors,
    remaining: count,
    message: keepGoing
      ? `Deleted ${totalDeleted} duplicates. Call again (or use ?batch=all) to continue.`
      : `Done — deleted ${totalDeleted} duplicates. ${count ?? "?"} files remain.`,
  });
}
