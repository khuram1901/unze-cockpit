import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// GET — returns last 4 entries for a given form type
//
// ?form=fuel&vehicleId=UUID
// ?form=maintenance&vehicleId=UUID
// ?form=solar&branchId=UUID
// ?form=utility&locationId=UUID&meterLabel=Meter+1

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const form = searchParams.get("form");
  const supabase = createServiceClient();

  if (form === "fuel") {
    const vehicleId = searchParams.get("vehicleId");
    if (!vehicleId) return Response.json({ data: [] });

    const { data } = await supabase
      .from("admin_fuel_log")
      .select("date, quantity_litres, price_per_litre, amount_pkr, current_odometer, km_per_litre")
      .eq("vehicle_id", vehicleId)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(4);

    return Response.json({ data: data || [] });
  }

  if (form === "maintenance") {
    const vehicleId = searchParams.get("vehicleId");
    if (!vehicleId) return Response.json({ data: [] });

    const { data } = await supabase
      .from("admin_vehicle_maintenance")
      .select("date, work_type, description, odometer_km, cost_pkr, workshop")
      .eq("vehicle_id", vehicleId)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(4);

    return Response.json({ data: data || [] });
  }

  if (form === "solar") {
    const branchId = searchParams.get("branchId");
    if (!branchId) return Response.json({ data: [] });

    const { data } = await supabase
      .from("admin_solar_readings")
      .select("date, units_produced_kwh, status")
      .eq("branch_id", branchId)
      .order("date", { ascending: false })
      .limit(4);

    return Response.json({ data: data || [] });
  }

  if (form === "utility") {
    const locationId  = searchParams.get("locationId");
    const meterLabel  = searchParams.get("meterLabel") || "Meter 1";
    if (!locationId) return Response.json({ data: [] });

    const { data } = await supabase
      .from("admin_utility_readings")
      .select("reading_date, current_reading, previous_reading, units_consumed, bill_amount_pkr, meter_label")
      .eq("location_id", locationId)
      .eq("meter_label", meterLabel)
      .order("reading_date", { ascending: false })
      .limit(4);

    return Response.json({ data: data || [] });
  }

  return Response.json({ data: [] });
}
