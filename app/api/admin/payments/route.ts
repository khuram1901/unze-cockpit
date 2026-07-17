import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// GET — payment calendar for a year: ?year=2026
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()), 10);

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("get_eobi_payment_calendar", { p_year: year });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ data });
}

// POST — record a payment
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const { entity, payment_type, month, amount_pkr, date_paid, challan_number, notes } = body;

  if (!entity || !payment_type || !month || !date_paid) {
    return Response.json({ error: "entity, payment_type, month, and date_paid are required" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("admin_eobi_payments")
    .upsert(
      {
        entity,
        payment_type,
        month,
        amount_pkr: amount_pkr ?? null,
        date_paid,
        challan_number: challan_number || null,
        notes: notes || null,
        created_by: auth.email,
      },
      { onConflict: "entity,payment_type,month" }
    );

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
