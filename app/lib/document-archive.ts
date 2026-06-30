import { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "source-documents";

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

// Stores the original PDF bytes in Storage and indexes it in document_archive,
// so parsed figures can always be traced back to and re-derived from the
// source file even if it's later deleted from Gmail/Drive. Failures here are
// logged but never block the parse/save flow that called this.
export async function archiveSourceDocument(params: ArchiveDocParams): Promise<void> {
  const { supabase, buffer, filename, docType, companyId, positionDate, source, uploadedBy } = params;

  try {
    const datePart = positionDate || "unknown-date";
    const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const storagePath = `${docType}/${companyId}/${datePart}/${Date.now()}_${safeFilename}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, { contentType: "application/pdf", upsert: false });

    if (uploadError) {
      console.error(`document-archive: upload failed for ${filename}:`, uploadError.message);
      return;
    }

    const { error: insertError } = await supabase.from("document_archive").insert({
      doc_type: docType,
      company_id: companyId,
      position_date: positionDate,
      storage_path: storagePath,
      original_filename: filename,
      source,
      uploaded_by: uploadedBy || null,
    });

    if (insertError) {
      console.error(`document-archive: index insert failed for ${filename}:`, insertError.message);
    }
  } catch (err) {
    console.error(`document-archive: unexpected error archiving ${filename}:`, err);
  }
}
