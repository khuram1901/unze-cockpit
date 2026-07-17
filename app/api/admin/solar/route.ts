import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// POST — log a daily solar reading
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const { branch_id, date, production_kwh, status, notes } = body;

  if (!branch_id || !date) {
    return Response.json({ error: "branch_id and date are required" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("admin_solar_readings")
    .upsert(
      {
        branch_id,
        date,
        production_kwh: production_kwh != null ? parseFloat(production_kwh) : null,
        status: status || "Active",
        notes: notes || null,
        entered_by: auth.email,
      },
      { onConflict: "branch_id,date" }
    );

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
