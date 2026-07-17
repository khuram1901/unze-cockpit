import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// GET — last utility reading for a location+meter: ?location_id=uuid&meter_label=Meter+1
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const location_id  = searchParams.get("location_id");
  const meter_label  = searchParams.get("meter_label") || "Meter 1";
  if (!location_id) return Response.json({ data: null });

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("get_last_utility_reading", {
    p_location_id: location_id,
    p_meter_label: meter_label,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ data: data?.[0] ?? null });
}

// POST — log a utility meter reading
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const {
    location_id, meter_label, utility_company,
    reading_date, current_reading, previous_reading, bill_amount_pkr,
  } = body;

  if (!location_id || !reading_date || current_reading == null) {
    return Response.json({
      error: "location_id, reading_date, and current_reading are required",
    }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from("admin_utility_readings").insert({
    location_id,
    meter_label: meter_label || "Meter 1",
    utility_company: utility_company || null,
    reading_date,
    current_reading:  parseInt(current_reading),
    previous_reading: previous_reading != null ? parseInt(previous_reading) : null,
    bill_amount_pkr:  bill_amount_pkr  != null ? parseFloat(bill_amount_pkr) : null,
    entered_by: auth.email,
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
