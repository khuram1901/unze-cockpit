import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// POST — log vehicle maintenance work
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const {
    vehicle_id, date, work_type, description,
    odometer_km, workshop, cost_pkr, next_service_due,
  } = body;

  if (!vehicle_id || !date || !work_type || cost_pkr == null) {
    return Response.json({
      error: "vehicle_id, date, work_type, and cost_pkr are required",
    }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from("admin_vehicle_maintenance").insert({
    vehicle_id,
    date,
    work_type,
    description: description || null,
    odometer_km: odometer_km != null ? parseInt(odometer_km) : null,
    workshop: workshop || null,
    cost_pkr: parseFloat(cost_pkr),
    next_service_due: next_service_due || null,
    entered_by: auth.email,
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
