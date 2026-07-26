import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

const ADMIN_EMAILS = ["khuram1901@gmail.com", "k.saleem@unzegroup.com"];

async function checkCanManage(auth: { email: string }, supabase: ReturnType<typeof createServiceClient>) {
  if (ADMIN_EMAILS.includes(auth.email.toLowerCase())) return true;
  const { data: member } = await supabase.from("members").select("id").eq("email", auth.email).single();
  if (!member) return false;
  const { data: perm } = await supabase.from("member_permissions")
    .select("can_access_admin_ops, can_access_banking")
    .eq("member_id", member.id).single();
  return perm?.can_access_admin_ops === true || perm?.can_access_banking === true;
}

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

  const supabase = createServiceClient();
  if (!(await checkCanManage(auth, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const body = await request.json();
  const { entity, payment_type, month, amount_pkr, date_paid, challan_number, notes } = body;

  if (!entity || !payment_type || !month || !date_paid) {
    return Response.json({ error: "entity, payment_type, month, and date_paid are required" }, { status: 400 });
  }
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
