/**
 * document-archive.ts — DISABLED (2026-08-31)
 *
 * PDF archival into the source-documents bucket has been removed.
 * All structured data (daily_cash_position, bank_position_snapshots,
 * cash_sheet_transactions, pdc_maturity_buckets) is the system of record.
 * Keeping raw PDFs was redundant and caused 700K duplicate files / 1.5 GB
 * of database metadata bloat.
 *
 * The function signature is preserved so existing callers compile without
 * changes. It simply returns immediately without uploading or inserting.
 */

import { SupabaseClient } from "@supabase/supabase-js";

export type ArchiveDocParams = {
  supabase: SupabaseClient;
  buffer: Buffer;
  filename: string;
  docType: "cash_flow" | "bank_position";
  companyId: string;
  positionDate: string | null;
  source: "manual" | "gmail-auto";
  uploadedBy?: string | null;
};

// No-op: PDF archival disabled. All callers remain valid TypeScript.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function archiveSourceDocument(_params: ArchiveDocParams): Promise<void> {
  return;
}
