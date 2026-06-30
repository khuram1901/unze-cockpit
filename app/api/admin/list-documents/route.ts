import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

const BUCKET = "source-documents";
const ADMIN_EMAIL = "khuram1901@gmail.com";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  if (auth.email.toLowerCase() !== ADMIN_EMAIL) {
    return Response.json({ error: "Admin only" }, { status: 403 });
  }

  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const docType = searchParams.get("docType");
  const companyId = searchParams.get("companyId");

  let query = supabase
    .from("document_archive")
    .select("id, doc_type, company_id, position_date, original_filename, storage_path, source, uploaded_by, created_at")
    .order("position_date", { ascending: false })
    .limit(200);

  if (docType) query = query.eq("doc_type", docType);
  if (companyId) query = query.eq("company_id", companyId);

  const { data, error } = await query;
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ documents: data || [] });
}

// Returns a short-lived signed URL for downloading one archived source PDF.
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  if (auth.email.toLowerCase() !== ADMIN_EMAIL) {
    return Response.json({ error: "Admin only" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const storagePath = body.storagePath as string | undefined;
  if (!storagePath) {
    return Response.json({ error: "storagePath is required" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 300);

  if (error || !data) {
    return Response.json({ error: error?.message || "Could not create signed URL" }, { status: 500 });
  }

  return Response.json({ url: data.signedUrl });
}
