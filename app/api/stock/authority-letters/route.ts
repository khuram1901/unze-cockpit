import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

function canManage(role: string, department: string | null) {
  return role === "Admin" || role === "Executive" ||
    (role === "Manager" && department === "Unze Trading Ops");
}

// Returns the total qty already issued in letters for a PO (per size)
async function getPoLetterTotals(supabase: ReturnType<typeof import("../../../lib/supabase-server").createServiceClient>, poId: string, excludeId?: string) {
  let query = supabase
    .from("authority_letters")
    .select("qty_31, qty_36, qty_45, qty_meter")
    .eq("po_id", poId);
  if (excludeId) query = query.neq("id", excludeId);
  const { data } = await query;
  return (data || []).reduce(
    (acc, r) => ({
      qty_31: acc.qty_31 + (r.qty_31 || 0),
      qty_36: acc.qty_36 + (r.qty_36 || 0),
      qty_45: acc.qty_45 + (r.qty_45 || 0),
      qty_meter: acc.qty_meter + (r.qty_meter || 0),
    }),
    { qty_31: 0, qty_36: 0, qty_45: 0, qty_meter: 0 }
  );
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const poId = searchParams.get("poId");
  const contractorId = searchParams.get("contractorId");
  const letterNumber = searchParams.get("letterNumber");

  // Lookup by letter number (plant member dispatch flow) — returns single letter with remaining balances
  if (letterNumber) {
    const plantId = searchParams.get("plantId");
    let q = supabase
      .from("authority_letters")
      .select("*, purchase_orders(id, po_number, customer_name, plant_id), contractors(id, name)")
      .ilike("letter_number", letterNumber.trim());
    if (plantId) {
      // Filter via the linked PO's plant_id
      q = q.eq("purchase_orders.plant_id", plantId);
    }
    const { data, error } = await q.limit(1).maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!data) return Response.json({ letter: null });

    // Compute dispatched so far (opening + all dispatch_records)
    const { data: records } = await supabase
      .from("dispatch_records")
      .select("qty_31, qty_36, qty_45, qty_meter")
      .eq("authority_letter_id", data.id);
    const dispatched = (records || []).reduce(
      (acc, r) => ({
        qty_31: acc.qty_31 + (r.qty_31 || 0),
        qty_36: acc.qty_36 + (r.qty_36 || 0),
        qty_45: acc.qty_45 + (r.qty_45 || 0),
        qty_meter: acc.qty_meter + (r.qty_meter || 0),
      }),
      {
        qty_31: data.opening_dispatched_31 || 0,
        qty_36: data.opening_dispatched_36 || 0,
        qty_45: data.opening_dispatched_45 || 0,
        qty_meter: data.opening_dispatched_meter || 0,
      }
    );

    const po = data.purchase_orders as { id: string; po_number: string; customer_name: string } | null;
    const contractor = data.contractors as { id: string; name: string } | null;

    return Response.json({
      letter: {
        id: data.id,
        letter_number: data.letter_number,
        po_id: po?.id || data.po_id,
        contractor_id: contractor?.id || data.contractor_id,
        po_number: po?.po_number || "",
        customer_name: po?.customer_name || "",
        contractor_name: contractor?.name || "",
        qty_31: data.qty_31 || 0,
        qty_36: data.qty_36 || 0,
        qty_45: data.qty_45 || 0,
        qty_meter: data.qty_meter || 0,
        remaining_31: Math.max(0, (data.qty_31 || 0) - dispatched.qty_31),
        remaining_36: Math.max(0, (data.qty_36 || 0) - dispatched.qty_36),
        remaining_45: Math.max(0, (data.qty_45 || 0) - dispatched.qty_45),
        remaining_meter: Math.max(0, (data.qty_meter || 0) - dispatched.qty_meter),
      },
    });
  }

  let query = supabase
    .from("authority_letters")
    .select("*, contractors(name)")
    .order("created_at", { ascending: false });

  if (poId) query = query.eq("po_id", poId);
  if (contractorId) query = query.eq("contractor_id", contractorId);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ letters: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { data: member } = await supabase
    .from("members").select("role, department").eq("email", auth.email).single();

  if (!member || !canManage(member.role, member.department)) {
    return Response.json({ error: "Ops Manager or Admin required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const {
    po_id, contractor_id, letter_number, issue_date, issued_by,
    expiry_date = null,
    qty_31 = 0, qty_36 = 0, qty_45 = 0, qty_meter = 0,
    opening_dispatched_31 = 0, opening_dispatched_36 = 0,
    opening_dispatched_45 = 0, opening_dispatched_meter = 0,
    notes,
  } = body;

  if (!po_id || !contractor_id || !letter_number || !issue_date || !issued_by) {
    return Response.json({ error: "po_id, contractor_id, letter_number, issue_date, issued_by are required" }, { status: 400 });
  }

  // Validate: sum of all letters for this PO must not exceed PO ordered qty
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("ordered_31, ordered_36, ordered_45, ordered_meter")
    .eq("id", po_id).single();

  if (po) {
    const existing = await getPoLetterTotals(supabase, po_id);
    const overflows = [
      { size: "31ft", issued: existing.qty_31 + qty_31, ordered: po.ordered_31 },
      { size: "36ft", issued: existing.qty_36 + qty_36, ordered: po.ordered_36 },
      { size: "45ft", issued: existing.qty_45 + qty_45, ordered: po.ordered_45 },
      { size: "meter", issued: existing.qty_meter + qty_meter, ordered: po.ordered_meter },
    ].filter((s) => s.ordered > 0 && s.issued > s.ordered);

    if (overflows.length > 0) {
      const detail = overflows.map((s) => `${s.size}: authorized ${s.issued} of ${s.ordered} ordered`).join(", ");
      return Response.json({ error: `Authority letters would exceed PO ordered qty — ${detail}` }, { status: 400 });
    }
  }

  // Ensure contractor is linked to this PO
  await supabase.from("po_contractors")
    .upsert({ po_id, contractor_id }, { onConflict: "po_id,contractor_id" });

  const { data, error } = await supabase
    .from("authority_letters")
    .insert({
      po_id, contractor_id, letter_number, issue_date, issued_by,
      expiry_date: expiry_date || null,
      qty_31, qty_36, qty_45, qty_meter,
      opening_dispatched_31, opening_dispatched_36,
      opening_dispatched_45, opening_dispatched_meter,
      notes: notes || null, created_by: auth.email,
    })
    .select().single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ letter: data }, { status: 201 });
}
