import { NextRequest } from "next/server";
import { createServiceClient } from "../../../../lib/supabase-server";
import { requireAuth } from "../../../../lib/api-auth";
import { isAdmin } from "../../../../lib/admin-config";

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

// ── POST /api/banking/cash-sheets/transactions ────────────────────────────────
// Add a single transaction to an existing sheet.
// Body: { sheet_id, txn_type, description, amount_pkr, bank_account?, reference?, category? }

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  if (!(await checkBankingAccess(auth.email, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const body = await request.json();
  const { sheet_id, txn_type, description, amount_pkr, bank_account, reference, category } = body as {
    sheet_id: string;
    txn_type: "payment" | "receipt";
    description: string;
    amount_pkr: number;
    bank_account?: string;
    reference?: string;
    category?: string;
  };

  if (!sheet_id || !txn_type || !description || amount_pkr == null) {
    return Response.json(
      { error: "sheet_id, txn_type, description, and amount_pkr are required" },
      { status: 400 }
    );
  }
  if (!["payment", "receipt"].includes(txn_type)) {
    return Response.json({ error: "txn_type must be payment or receipt" }, { status: 400 });
  }
  if (amount_pkr <= 0) {
    return Response.json({ error: "amount_pkr must be greater than 0" }, { status: 400 });
  }

  // Fetch sheet for denormalised fields
  const { data: sheet } = await supabase
    .from("cash_sheet_uploads")
    .select("company, sheet_date")
    .eq("id", sheet_id)
    .single();

  if (!sheet) return Response.json({ error: "Sheet not found" }, { status: 404 });

  // Determine next sort_order for this txn_type
  const { count } = await supabase
    .from("cash_sheet_transactions")
    .select("id", { count: "exact", head: true })
    .eq("sheet_id", sheet_id)
    .eq("txn_type", txn_type);

  const { data, error } = await supabase
    .from("cash_sheet_transactions")
    .insert({
      sheet_id,
      company: sheet.company,
      sheet_date: sheet.sheet_date,
      txn_type,
      description,
      amount_pkr,
      bank_account: bank_account || null,
      reference: reference || null,
      category: category || null,
      sort_order: count ?? 0,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, data });
}

// ── DELETE /api/banking/cash-sheets/transactions?id=<uuid> ───────────────────
// Remove a single transaction.

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  if (!(await checkBankingAccess(auth.email, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id query param required" }, { status: 400 });

  const { error } = await supabase.from("cash_sheet_transactions").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
