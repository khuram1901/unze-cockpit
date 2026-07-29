import { NextRequest } from "next/server";
import { createServiceClient } from "../../../../lib/supabase-server";
import { requireAuth } from "../../../../lib/api-auth";

// ── Auth helpers ──────────────────────────────────────────────────────────────

const ADMIN_EMAILS = ["khuram1901@gmail.com", "k.saleem@unzegroup.com"];
const RESTAURANT_COMPANIES = ["BRNH", "HD", "KKJ"];

async function checkBankingAccess(
  email: string,
  supabase: ReturnType<typeof createServiceClient>,
): Promise<boolean> {
  if (ADMIN_EMAILS.includes(email.toLowerCase())) return true;
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

// Read-only: banking users + restaurants_pnl users for restaurant companies
async function checkReadAccess(
  email: string,
  supabase: ReturnType<typeof createServiceClient>,
  company?: string,
): Promise<boolean> {
  if (ADMIN_EMAILS.includes(email.toLowerCase())) return true;
  const { data: member } = await supabase
    .from("members")
    .select("id")
    .eq("email", email)
    .single();
  if (!member) return false;
  const { data: perm } = await supabase
    .from("member_permissions")
    .select("can_access_banking, can_view_restaurants_pnl")
    .eq("member_id", member.id)
    .single();
  if (perm?.can_access_banking === true) return true;
  if (perm?.can_view_restaurants_pnl === true && company && RESTAURANT_COMPANIES.includes(company)) return true;
  return false;
}

// ── GET /api/banking/cash-sheets/[id] ─────────────────────────────────────────

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id } = await context.params;

  const supabase = createServiceClient();

  // Fetch sheet first so we can pass company to the auth check
  const { data, error } = await supabase
    .from("cash_sheet_uploads")
    .select("*, cash_sheet_transactions(*)")
    .eq("id", id)
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "Not found" }, { status: 404 });

  if (!(await checkReadAccess(auth.email, supabase, data.company))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  // Split and sort transactions
  type Txn = { txn_type: string; sort_order: number; created_at: string };
  const txns: Txn[] = data.cash_sheet_transactions || [];
  const receipts = txns
    .filter((t) => t.txn_type === "receipt")
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
  const payments = txns
    .filter((t) => t.txn_type === "payment")
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));

  // Generate signed URL for PDF if present
  let pdf_signed_url: string | null = null;
  if (data.pdf_storage_path) {
    const { data: signed } = await supabase.storage
      .from("cash-sheets")
      .createSignedUrl(data.pdf_storage_path, 3600);
    pdf_signed_url = signed?.signedUrl ?? null;
  }

  return Response.json({
    data: {
      ...data,
      cash_sheet_transactions: undefined,
      receipts,
      payments,
      pdf_signed_url,
    },
  });
}

// ── PATCH /api/banking/cash-sheets/[id] ──────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id } = await context.params;

  const supabase = createServiceClient();
  if (!(await checkBankingAccess(auth.email, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const body = await request.json();
  const { opening_balance_pkr, closing_balance_pkr, notes, pdf_storage_path } = body;

  const { error } = await supabase
    .from("cash_sheet_uploads")
    .update({
      ...(opening_balance_pkr !== undefined && { opening_balance_pkr }),
      ...(closing_balance_pkr !== undefined && { closing_balance_pkr }),
      ...(notes !== undefined && { notes }),
      ...(pdf_storage_path !== undefined && { pdf_storage_path }),
    })
    .eq("id", id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

// ── DELETE /api/banking/cash-sheets/[id] ─────────────────────────────────────

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id } = await context.params;

  const supabase = createServiceClient();
  if (!(await checkBankingAccess(auth.email, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  // Fetch PDF path before deleting
  const { data: sheet } = await supabase
    .from("cash_sheet_uploads")
    .select("pdf_storage_path")
    .eq("id", id)
    .single();

  const { error } = await supabase
    .from("cash_sheet_uploads")
    .delete()
    .eq("id", id);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Remove PDF from storage (best-effort)
  if (sheet?.pdf_storage_path) {
    await supabase.storage.from("cash-sheets").remove([sheet.pdf_storage_path]);
  }

  return Response.json({ ok: true });
}
