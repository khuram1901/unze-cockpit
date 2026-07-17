import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

function isOpsManager(role: string, department: string | null) {
  return role === "Manager" && department === "Unze Trading Ops";
}

function isPrivileged(role: string) {
  return role === "Admin" || role === "CEO" || role === "Executive";
}

function canManagePOs(role: string, department: string | null) {
  return isPrivileged(role) || isOpsManager(role, department);
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const plantId = searchParams.get("plantId");
  const includeClosedParam = searchParams.get("includeClosed");
  const includeClosed = includeClosedParam === "true";

  let query = supabase
    .from("purchase_orders")
    .select("id, plant_id, plant_name, customer_name, po_number, po_label, ordered_31, ordered_36, ordered_40, ordered_45, ordered_meter, variance_pct, status, is_system_unallocated, start_date, notes, opening_produced_31, opening_produced_36, opening_produced_40, opening_produced_45, opening_produced_meter")
    .order("created_at", { ascending: false });

  if (plantId) query = query.eq("plant_id", plantId);
  if (!includeClosed) query = query.eq("status", "Active");

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ purchaseOrders: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();

  // Get user role/department
  const { data: member } = await supabase
    .from("members")
    .select("role, department")
    .eq("email", auth.email)
    .single();

  if (!member || !canManagePOs(member.role, member.department)) {
    return Response.json({ error: "Ops Manager or Admin required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const {
    plant_id, plant_name, customer_name, po_number, po_label,
    ordered_31 = 0, ordered_36 = 0, ordered_45 = 0, ordered_meter = 0,
    start_date, notes,
    opening_produced_31 = 0, opening_produced_36 = 0,
    opening_produced_45 = 0, opening_produced_meter = 0,
  } = body;

  if (!plant_id || !customer_name || !po_number) {
    return Response.json({ error: "plant_id, customer_name, and po_number are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("purchase_orders")
    .insert({
      plant_id, plant_name: plant_name || "", customer_name,
      po_number, po_label: po_label || "",
      ordered_31, ordered_36, ordered_45, ordered_meter,
      start_date: start_date || null, notes: notes || null,
      opening_produced_31, opening_produced_36,
      opening_produced_45, opening_produced_meter,
      created_by: auth.email,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ purchaseOrder: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { data: member } = await supabase
    .from("members")
    .select("role, department")
    .eq("email", auth.email)
    .single();

  if (!member || !canManagePOs(member.role, member.department)) {
    return Response.json({ error: "Ops Manager or Admin required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { id, ...updates } = body;
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  // Never allow editing the system unallocated PO's core fields
  const { data: existing } = await supabase
    .from("purchase_orders")
    .select("is_system_unallocated")
    .eq("id", id)
    .single();

  if (existing?.is_system_unallocated) {
    return Response.json({ error: "System unallocated PO cannot be edited" }, { status: 400 });
  }

  const allowed = [
    "customer_name", "po_number", "po_label", "ordered_31", "ordered_36", "ordered_45",
    "ordered_meter", "start_date", "notes", "status",
    "opening_produced_31", "opening_produced_36", "opening_produced_45", "opening_produced_meter",
  ];
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of allowed) {
    if (k in updates) patch[k] = updates[k];
  }

  const { data, error } = await supabase
    .from("purchase_orders")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ purchaseOrder: data });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { data: member } = await supabase
    .from("members")
    .select("role, department")
    .eq("email", auth.email)
    .single();

  if (!member || !canManagePOs(member.role, member.department)) {
    return Response.json({ error: "Ops Manager or Admin required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { id } = body;
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const { data: existing } = await supabase
    .from("purchase_orders")
    .select("is_system_unallocated")
    .eq("id", id)
    .single();

  if (existing?.is_system_unallocated) {
    return Response.json({ error: "System unallocated PO cannot be deleted" }, { status: 400 });
  }

  const { error } = await supabase.from("purchase_orders").delete().eq("id", id);
  if (error) {
    // Postgres foreign-key "on delete restrict" violation (authority letters or
    // production allocations still point at this PO) — friendlier message than
    // the raw Postgres error text.
    if (error.code === "23503") {
      return Response.json(
        { error: "This PO has authority letters or production allocated against it — close it instead, or remove those first." },
        { status: 409 }
      );
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ success: true });
}
