import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// GET — last odometer reading for a vehicle: ?vehicle_id=uuid
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const vehicle_id = searchParams.get("vehicle_id");
  if (!vehicle_id) return Response.json({ data: null });

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("get_last_odometer", { p_vehicle_id: vehicle_id });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ data: data?.[0] ?? null });
}

// POST — log a fuel fill-up
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const {
    vehicle_id, date, price_per_litre, quantity_litres,
    previous_odometer, current_odometer, notes,
  } = body;

  if (!vehicle_id || !date || !price_per_litre || !quantity_litres) {
    return Response.json({
      error: "vehicle_id, date, price_per_litre, and quantity_litres are required",
    }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from("admin_fuel_log").insert({
    vehicle_id,
    date,
    price_per_litre: parseFloat(price_per_litre),
    quantity_litres: parseFloat(quantity_litres),
    previous_odometer: previous_odometer ? parseInt(previous_odometer) : null,
    current_odometer:  current_odometer  ? parseInt(current_odometer)  : null,
    notes: notes || null,
    entered_by: auth.email,
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

// ── Shared role check ─────────────────────────────────────────────────────────
// Must be Admin tier, Executive, or Manager in Admin department.
// requireAuth only returns { email }, so we look up role/dept from members.
async function checkAmendPermission(auth: { email: string }) {
  const supabase = createServiceClient();
  const { data: member } = await supabase
    .from("members")
    .select("role, department")
    .eq("email", auth.email)
    .maybeSingle();
  if (!member) return false;
  const { role, department } = member;
  return (
    ["Admin", "CEO", "Executive"].includes(role) ||
    (role === "Manager" && department === "Admin")
  );
}

// PATCH — amend an existing fuel entry
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const allowed = await checkAmendPermission(auth);
  if (!allowed) return Response.json({ error: "Insufficient permissions" }, { status: 403 });

  const body = await request.json();
  const { id, date, price_per_litre, quantity_litres, previous_odometer, current_odometer, notes } = body;
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (date)               updates.date              = date;
  if (price_per_litre != null) updates.price_per_litre = parseFloat(price_per_litre);
  if (quantity_litres != null) updates.quantity_litres = parseFloat(quantity_litres);
  updates.previous_odometer = previous_odometer != null ? parseInt(previous_odometer) : null;
  updates.current_odometer  = current_odometer  != null ? parseInt(current_odometer)  : null;
  updates.notes = notes ?? null;

  const supabase = createServiceClient();
  const { error } = await supabase.from("admin_fuel_log").update(updates).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

// DELETE — remove a fuel entry
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const allowed = await checkAmendPermission(auth);
  if (!allowed) return Response.json({ error: "Insufficient permissions" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const supabase = createServiceClient();
  const { error } = await supabase.from("admin_fuel_log").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
