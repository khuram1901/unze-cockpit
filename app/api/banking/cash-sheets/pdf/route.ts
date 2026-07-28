import { NextRequest } from "next/server";
import { createServiceClient } from "../../../../lib/supabase-server";
import { requireAuth } from "../../../../lib/api-auth";
import { parseCashFlowPDF } from "../../../../lib/pdf-parsers/cash-flow-parser";

// ── Auth helper ───────────────────────────────────────────────────────────────

async function checkBankingAccess(
  email: string,
  supabase: ReturnType<typeof createServiceClient>,
): Promise<boolean> {
  const ADMIN = ["khuram1901@gmail.com", "k.saleem@unzegroup.com"];
  if (ADMIN.includes(email.toLowerCase())) return true;
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

// ── POST /api/banking/cash-sheets/pdf ─────────────────────────────────────────
// Accepts a multipart/form-data upload with a single "pdf" file field plus
// "company" and "date" text fields.  Uploads to Supabase Storage bucket
// "cash-sheets" and returns the storage path.
//
// The client uploads here FIRST, then passes the returned path when creating
// the sheet via POST /api/banking/cash-sheets.
//
// Storage path layout: <company>/<YYYY>/<YYYY-MM-DD>.pdf

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

  const file = formData.get("pdf") as File | null;
  const company = formData.get("company") as string | null;
  const date = formData.get("date") as string | null; // YYYY-MM-DD

  if (!file || !company || !date) {
    return Response.json({ error: "pdf, company, and date fields are required" }, { status: 400 });
  }
  if (!["IFPL", "UTPL"].includes(company)) {
    return Response.json({ error: "company must be IFPL or UTPL" }, { status: 400 });
  }
  if (file.type !== "application/pdf" && !file.name.endsWith(".pdf")) {
    return Response.json({ error: "Only PDF files are accepted" }, { status: 400 });
  }
  if (file.size > 20 * 1024 * 1024) {
    return Response.json({ error: "PDF must be under 20 MB" }, { status: 400 });
  }

  const year = date.slice(0, 4);
  const storagePath = `${company}/${year}/${date}.pdf`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { error: uploadErr } = await supabase.storage
    .from("cash-sheets")
    .upload(storagePath, buffer, {
      contentType: "application/pdf",
      upsert: true, // allow replacing if re-uploading for same date
    });

  if (uploadErr) {
    return Response.json({ error: uploadErr.message }, { status: 500 });
  }

  // Parse the PDF to extract balances automatically so the caller can
  // populate opening/closing balance without the user typing them in.
  // Non-fatal — storage upload already succeeded.
  let parsed: {
    opening: number | null;
    closing: number | null;
    receipts: number | null;
    payments: number | null;
  } = { opening: null, closing: null, receipts: null, payments: null };
  let parseWarning: string | null = null;

  try {
    const results = await parseCashFlowPDF(buffer);
    if (results.length > 0) {
      const r = results[0];
      parsed = {
        opening: r.openingBalanceTotal,
        closing: r.closingBalanceUnzeTrading,
        receipts: r.receiptsTotal,
        payments: r.paymentsTotal,
      };
    }
  } catch (parseErr) {
    parseWarning = parseErr instanceof Error ? parseErr.message : String(parseErr);
    console.warn("cash-sheets/pdf: parse warning (non-fatal):", parseWarning);
  }

  return Response.json({ ok: true, path: storagePath, parsed, parseWarning });
}
