import { NextRequest } from "next/server";
import { createServiceClient } from "../../../../../lib/supabase-server";
import { requireAuth } from "../../../../../lib/api-auth";
import { hasBankingAccess } from "../../../../../lib/banking-access";

// ── Auth helper (same as ../route.ts) ────────────────────────────────────────


// ── POST /api/banking/cash-sheets/pdf/upload-url ─────────────────────────────
// Returns a signed upload URL so the browser can upload the PDF DIRECTLY to
// Supabase Storage. This bypasses Vercel's ~4.5 MB serverless request body
// limit (FUNCTION_PAYLOAD_TOO_LARGE), which rejected larger scanned cash
// sheets before the old /pdf route's code even ran.
//
// Body: { company: "UTPL"|"IFPL"|"BRNH"|"HD"|"KKJ", date: "YYYY-MM-DD" }
// Response: { ok, path, token } — pass both to
//   supabase.storage.from("cash-sheets").uploadToSignedUrl(path, token, file)

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  if (!(await hasBankingAccess(auth.email))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  let body: { company?: string; date?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const { company, date } = body;
  if (!company || !date) {
    return Response.json({ error: "company and date are required" }, { status: 400 });
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

  // Remove any existing object first — signed upload URLs cannot overwrite,
  // and re-uploading for the same date must replace the previous PDF.
  await supabase.storage.from("cash-sheets").remove([storagePath]);

  const { data, error } = await supabase.storage
    .from("cash-sheets")
    .createSignedUploadUrl(storagePath);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true, path: storagePath, token: data.token, signedUrl: data.signedUrl });
}
