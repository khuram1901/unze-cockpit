import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// GET — HR EOBI summary KPIs + pending challan list
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const db = createServiceClient();
  const { data, error } = await db.rpc("get_hr_eobi_summary");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ data: data?.[0] ?? null });
}

// POST — HR raises a new pending challan (no date_paid yet)
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const { entity, payment_type, month, amount_pkr, enrolled_count, notes } = body;

  if (!entity || !payment_type || !month) {
    return Response.json(
      { error: "entity, payment_type and month are required" },
      { status: 400 }
    );
  }

  // month must be the first day of the month (YYYY-MM-01)
  const monthDate = month.slice(0, 7) + "-01";

  const db = createServiceClient();
  const { error } = await db.from("admin_eobi_payments").upsert(
    {
      entity,
      payment_type,
      month: monthDate,
      amount_pkr: amount_pkr ?? null,
      enrolled_count: enrolled_count ?? null,
      notes: notes || null,
      created_by: auth.email,
      // date_paid intentionally omitted — NULL means "pending / not yet deposited"
    },
    { onConflict: "entity,payment_type,month" }
  );

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

// DELETE — remove a pending (unpaid) challan only
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id } = await request.json();
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const db = createServiceClient();
  // Safety: only allow deleting records that haven't been paid yet
  const { error } = await db
    .from("admin_eobi_payments")
    .delete()
    .eq("id", id)
    .is("date_paid", null);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
