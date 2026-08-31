/**
 * POST /api/admin/cleanup-source-docs
 * ─────────────────────────────────────────────────────────────────
 * Deletes ALL files from the source-documents Storage bucket.
 * PDF archival has been discontinued (migration 237); document_archive
 * is already truncated. This route empties the storage bucket so the
 * 27 GB of PDF files and 1.28 GB of metadata are fully reclaimed.
 *
 * Processes in batches of 100 files per call (Storage API limit).
 * Call repeatedly (or use ?batch=all) until remaining = 0.
 *
 * Access: Admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";

const BUCKET = "source-documents";
const BATCH_SIZE = 100;

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const db = createServiceClient();

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
  const maxBatches = batchParam === "all" ? 9999 : parseInt(batchParam, 10) || 1;

  let totalDeleted = 0;
  let batchCount = 0;

  while (batchCount < maxBatches) {
    // List a page of files
    const { data: files, error: listErr } = await db.storage
      .from(BUCKET)
      .list("", { limit: BATCH_SIZE });

    if (listErr) {
      return NextResponse.json({ error: listErr.message, deleted: totalDeleted }, { status: 500 });
    }
    if (!files || files.length === 0) break;

    // Storage .list() at root returns top-level folders, not individual files.
    // We need to list recursively. Use the storage.objects table to get paths.
    const { data: objects } = await db
      .from("storage.objects" as never)
      .select("name")
      .eq("bucket_id", BUCKET)
      .limit(BATCH_SIZE) as { data: { name: string }[] | null };

    if (!objects || objects.length === 0) break;

    const paths = objects.map((o) => o.name);
    const { error: delErr } = await db.storage.from(BUCKET).remove(paths);
    if (delErr) {
      return NextResponse.json({ error: delErr.message, deleted: totalDeleted }, { status: 500 });
    }

    totalDeleted += paths.length;
    batchCount++;
    if (paths.length < BATCH_SIZE) break;
  }

  // Count remaining via storage listing
  const { data: check } = await db.storage.from(BUCKET).list("", { limit: 1 });
  const remaining = check?.length ?? 0;

  return NextResponse.json({
    ok: true,
    deleted: totalDeleted,
    batches: batchCount,
    remaining,
    message: remaining === 0
      ? `All files deleted. Bucket is empty.`
      : `Deleted ${totalDeleted} files. Call again to continue (${remaining}+ remaining).`,
  });
}
