import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const entryId = searchParams.get("entryId");
  const poId = searchParams.get("poId");

  let query = supabase
    .from("production_allocations")
    .select("*, purchase_orders(po_number, customer_name, po_label)");

  if (entryId) query = query.eq("production_entry_id", entryId);
  if (poId) query = query.eq("po_id", poId);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ allocations: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const body = await request.json().catch(() => ({}));

  // Accepts an array of allocations for one production entry
  const { production_entry_id, allocations } = body as {
    production_entry_id: string;
    allocations: Array<{
      po_id: string;
      qty_31?: number; qty_36?: number; qty_45?: number; qty_meter?: number;
    }>;
  };

  if (!production_entry_id || !Array.isArray(allocations) || allocations.length === 0) {
    return Response.json({ error: "production_entry_id and allocations[] are required" }, { status: 400 });
  }

  // Validate: total allocated per size must not exceed what's in the production entry
  const { data: entry } = await supabase
    .from("production_entries")
    .select("qty_31, qty_36, qty_45, qty_meter")
    .eq("id", production_entry_id)
    .single();

  if (!entry) return Response.json({ error: "Production entry not found" }, { status: 404 });

  const totalAllocated = allocations.reduce(
    (acc, a) => ({
      qty_31: acc.qty_31 + (a.qty_31 || 0),
      qty_36: acc.qty_36 + (a.qty_36 || 0),
      qty_45: acc.qty_45 + (a.qty_45 || 0),
      qty_meter: acc.qty_meter + (a.qty_meter || 0),
    }),
    { qty_31: 0, qty_36: 0, qty_45: 0, qty_meter: 0 }
  );

  const overflows = [
    { size: "31ft", allocated: totalAllocated.qty_31, entry: entry.qty_31 || 0 },
    { size: "36ft", allocated: totalAllocated.qty_36, entry: entry.qty_36 || 0 },
    { size: "45ft", allocated: totalAllocated.qty_45, entry: entry.qty_45 || 0 },
    { size: "meter", allocated: totalAllocated.qty_meter, entry: entry.qty_meter || 0 },
  ].filter((s) => s.allocated > s.entry);

  if (overflows.length > 0) {
    const detail = overflows.map((s) => `${s.size}: allocating ${s.allocated} but entry only has ${s.entry}`).join(", ");
    return Response.json({ error: `Allocations exceed entry totals — ${detail}` }, { status: 400 });
  }

  // Validate 3% cap per PO
  for (const alloc of allocations) {
    const { data: po } = await supabase
      .from("purchase_orders")
      .select("ordered_31, ordered_36, ordered_45, ordered_meter, variance_pct, is_system_unallocated, opening_produced_31, opening_produced_36, opening_produced_45, opening_produced_meter")
      .eq("id", alloc.po_id).single();

    if (!po || po.is_system_unallocated) continue; // unallocated PO has no cap

    // Get total already allocated to this PO (excluding this entry)
    const { data: existing } = await supabase
      .from("production_allocations")
      .select("qty_31, qty_36, qty_45, qty_meter")
      .eq("po_id", alloc.po_id)
      .neq("production_entry_id", production_entry_id);

    const alreadyProduced = (existing || []).reduce(
      (acc, r) => ({
        qty_31: acc.qty_31 + (r.qty_31 || 0),
        qty_36: acc.qty_36 + (r.qty_36 || 0),
        qty_45: acc.qty_45 + (r.qty_45 || 0),
        qty_meter: acc.qty_meter + (r.qty_meter || 0),
      }),
      {
        qty_31: po.opening_produced_31 || 0,
        qty_36: po.opening_produced_36 || 0,
        qty_45: po.opening_produced_45 || 0,
        qty_meter: po.opening_produced_meter || 0,
      }
    );

    const varianceFactor = 1 + (po.variance_pct || 3) / 100;
    const capBreaches = [
      { size: "31ft", total: alreadyProduced.qty_31 + (alloc.qty_31 || 0), cap: (po.ordered_31 || 0) * varianceFactor },
      { size: "36ft", total: alreadyProduced.qty_36 + (alloc.qty_36 || 0), cap: (po.ordered_36 || 0) * varianceFactor },
      { size: "45ft", total: alreadyProduced.qty_45 + (alloc.qty_45 || 0), cap: (po.ordered_45 || 0) * varianceFactor },
      { size: "meter", total: alreadyProduced.qty_meter + (alloc.qty_meter || 0), cap: (po.ordered_meter || 0) * varianceFactor },
    ].filter((s) => s.cap > 0 && s.total > s.cap);

    if (capBreaches.length > 0) {
      const detail = capBreaches.map((s) => `${s.size}: ${s.total} would exceed ${s.cap.toFixed(0)} (ordered + ${po.variance_pct}%)`).join(", ");
      return Response.json({ error: `Production cap exceeded for this PO — ${detail}` }, { status: 400 });
    }
  }

  // Delete existing allocations for this entry and replace
  await supabase.from("production_allocations").delete().eq("production_entry_id", production_entry_id);

  const rows = allocations.map((a) => ({
    production_entry_id,
    po_id: a.po_id,
    qty_31: a.qty_31 || 0,
    qty_36: a.qty_36 || 0,
    qty_45: a.qty_45 || 0,
    qty_meter: a.qty_meter || 0,
  }));

  const { data, error } = await supabase
    .from("production_allocations")
    .insert(rows)
    .select();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ allocations: data }, { status: 201 });
}
