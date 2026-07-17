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
