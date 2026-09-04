import { NextRequest } from "next/server";
import { createServiceClient } from "../../../../../lib/supabase-server";
import { requireAuth } from "../../../../../lib/api-auth";
import { isAdmin } from "../../../../../lib/admin-config";

// ── Auth helper ───────────────────────────────────────────────────────────────

async function checkBankingAccess(
  email: string,
  supabase: ReturnType<typeof createServiceClient>,
): Promise<boolean> {
  if (isAdmin(email.toLowerCase())) return true;
  const { data: member } = await supabase
    .from("members")
    .select("id")
    .eq("email", email)
    .single();
  if (!member) return false;
  const { data: perm } = await supabase
    .from("member_permissions")
    .select("can_access_banking")
    .eq("member_id", member.id)
    .single();
  return perm?.can_access_banking === true;
}

// ── POST /api/banking/cash-sheets/pdf/upload ──────────────────────────────────
// Accepts multipart/form-data with fields: file (PDF), company, date (YYYY-MM-DD)
// Uploads the PDF to Supabase Storage server-side — avoids browser CORS issues
// that prevent direct signed-URL uploads from the client.
//
// Note: Vercel serverless functions cap request bodies at ~4.5 MB.
// For larger files a signed-URL approach is needed, but typical cash sheets
// are well under this limit.

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  if (!(await checkBankingAccess(auth.email, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const company = formData.get("company") as string | null;
  const date = formData.get("date") as string | null;

  if (!file || !company || !date) {
    return Response.json({ error: "file, company and date are required" }, { status: 400 });
  }

  const VALID_COMPANIES = ["IFPL", "UTPL", "BRNH", "HD", "KKJ"];
  if (!VALID_COMPANIES.includes(company)) {
    return Response.json({ error: `company must be one of: ${VALID_COMPANIES.join(", ")}` }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const year = date.slice(0, 4);
  const storagePath = `${company}/${year}/${date}.pdf`;

  // Remove any existing file first so upsert works cleanly
  await supabase.storage.from("cash-sheets").remove([storagePath]);

  const buffer = await file.arrayBuffer();
  const { error } = await supabase.storage
    .from("cash-sheets")
    .upload(storagePath, buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true, path: storagePath });
}
