import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

function canManage(role: string, department: string | null) {
  return role === "Admin" || role === "CEO" || role === "Executive" ||
    (role === "Manager" && department === "Unze Trading Ops");
}

// Returns the total qty already issued in letters for a PO (per size).
// One RPC round-trip (rule 0) — the DB does the summing.
async function getPoLetterTotals(supabase: ReturnType<typeof import("../../../lib/supabase-server").createServiceClient>, poId: string, excludeId?: string) {
  const { data } = await supabase.rpc("get_po_letter_totals", {
    p_po_id: poId,
    p_exclude_letter_id: excludeId ?? null,
  });
  return (data || { qty_31: 0, qty_36: 0, qty_45: 0, qty_meter: 0 }) as { qty_31: number; qty_36: number; qty_45: number; qty_meter: number };
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const poId = searchParams.get("poId");
  const contractorId = searchParams.get("contractorId");
  const letterNumber = searchParams.get("letterNumber");
  const plantId = searchParams.get("plantId");
  const listAll = searchParams.get("listAll") === "true";

  // List all active letters for a plant (dispatch dropdown flow)
  if (listAll && plantId) {
    const { data, error } = await supabase.rpc("get_plant_authority_letters", { p_plant_id: plantId });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ letters: data || [] });
  }

  // Lookup by letter number (plant member dispatch flow) — returns single letter with remaining balances
  if (letterNumber) {
    const { data, error } = await supabase.rpc("get_authority_letter_lookup", {
      p_letter_number: letterNumber.trim(),
      p_plant_id: plantId || null,
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ letter: data || null });
  }

  let query = supabase
    .from("authority_letters")
    .select("id, po_id, contractor_id, letter_number, issue_date, issued_by, expiry_date, qty_31, qty_36, qty_40, qty_45, qty_meter, opening_dispatched_31, opening_dispatched_36, opening_dispatched_40, opening_dispatched_45, opening_dispatched_meter, notes, created_by, created_at, closed_at, closed_by, contractors(name)")
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

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { data: member } = await supabase
    .from("members").select("role, department").eq("email", auth.email).single();

  if (!member || !canManage(member.role, member.department)) {
    return Response.json({ error: "Ops Manager or Admin required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { id, contractor_id, letter_number, issue_date, issued_by, expiry_date, qty_31, qty_36, qty_45, qty_meter, notes, close } = body;

  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  // Close/reopen — Khuram, 18 Jul 2026: old letters with only a handful of
  // poles left uncollected (out of hundreds authorised) were warning
  // forever with no way to say "done with this one". Mirrors PO close:
  // the letter and its history stay put, it just stops nagging.
  if (close !== undefined) {
    const { data, error } = await supabase
      .from("authority_letters")
      .update(close ? { closed_at: new Date().toISOString(), closed_by: auth.email } : { closed_at: null, closed_by: null })
      .eq("id", id).select().single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ letter: data });
  }

  // Validate qty cap against PO ordered totals (excluding this letter)
  const { data: existing } = await supabase
    .from("authority_letters").select("po_id").eq("id", id).single();

  if (existing?.po_id && (qty_31 !== undefined || qty_36 !== undefined || qty_45 !== undefined || qty_meter !== undefined)) {
    const { data: po } = await supabase
      .from("purchase_orders")
      .select("ordered_31, ordered_36, ordered_45, ordered_meter")
      .eq("id", existing.po_id).single();

    if (po) {
      const otherTotals = await getPoLetterTotals(supabase, existing.po_id, id);
      const overflows = [
        { size: "31ft", issued: otherTotals.qty_31 + (qty_31 ?? 0), ordered: po.ordered_31 },
        { size: "36ft", issued: otherTotals.qty_36 + (qty_36 ?? 0), ordered: po.ordered_36 },
        { size: "45ft", issued: otherTotals.qty_45 + (qty_45 ?? 0), ordered: po.ordered_45 },
        { size: "meter", issued: otherTotals.qty_meter + (qty_meter ?? 0), ordered: po.ordered_meter },
      ].filter((s) => s.ordered > 0 && s.issued > s.ordered);

      if (overflows.length > 0) {
        const detail = overflows.map((s) => `${s.size}: would authorize ${s.issued} of ${s.ordered} ordered`).join(", ");
        return Response.json({ error: `Would exceed PO ordered qty — ${detail}` }, { status: 400 });
      }
    }
  }

  // Note: authority_letters has no updated_at column (unlike purchase_orders) —
  // setting one here caused every edit to fail with "Could not find the
  // 'updated_at' column of 'authority_letters' in the schema cache".
  const updates: Record<string, unknown> = {};
  if (contractor_id !== undefined) updates.contractor_id = contractor_id;
  if (letter_number !== undefined) updates.letter_number = letter_number;
  if (issue_date !== undefined) updates.issue_date = issue_date;
  if (issued_by !== undefined) updates.issued_by = issued_by;
  if (expiry_date !== undefined) updates.expiry_date = expiry_date || null;
  if (qty_31 !== undefined) updates.qty_31 = qty_31;
  if (qty_36 !== undefined) updates.qty_36 = qty_36;
  if (qty_45 !== undefined) updates.qty_45 = qty_45;
  if (qty_meter !== undefined) updates.qty_meter = qty_meter;
  if (notes !== undefined) updates.notes = notes || null;

  const { data, error } = await supabase
    .from("authority_letters").update(updates).eq("id", id).select().single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ letter: data });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { data: member } = await supabase
    .from("members").select("role, department").eq("email", auth.email).single();

  if (!member || !canManage(member.role, member.department)) {
    return Response.json({ error: "Ops Manager or Admin required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { id } = body;
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const { error } = await supabase.from("authority_letters").delete().eq("id", id);
  if (error) {
    // Postgres foreign-key "on delete restrict" violation (dispatch records
    // still point at this letter) — friendlier message than the raw error.
    if (error.code === "23503") {
      return Response.json(
        { error: "This letter has dispatch records against it — remove those first." },
        { status: 409 }
      );
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ success: true });
}
