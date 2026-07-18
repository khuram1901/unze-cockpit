import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// Emails that can manage vehicles (in addition to DB can_manage_locations flag)
const ADMIN_EMAILS = ["khuram1901@gmail.com", "k.saleem@unzegroup.com"];

async function checkCanManage(auth: { email: string }, supabase: ReturnType<typeof createServiceClient>) {
  if (ADMIN_EMAILS.includes(auth.email.toLowerCase())) return true;
  const { data: member } = await supabase
    .from("members").select("id").eq("email", auth.email).single();
  if (!member) return false;
  const { data: perm } = await supabase
    .from("member_permissions").select("can_manage_locations").eq("member_id", member.id).single();
  return perm?.can_manage_locations === true;
}

// GET — list all vehicles (active + inactive)
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("admin_vehicles")
    .select("id, name, plate_number, is_active, created_at")
    .order("name");

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ data });
}

// POST — create new vehicle or update existing (pass id to update)
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  if (!(await checkCanManage(auth, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const body = await request.json();
  const { id, name, plate_number, is_active, odometer_unit } = body;

  if (!name?.trim() || !plate_number?.trim()) {
    return Response.json({ error: "name and plate_number are required" }, { status: 400 });
  }

  const unit = odometer_unit === "miles" ? "miles" : "km";

  if (id) {
    // Update
    const { error } = await supabase
      .from("admin_vehicles")
      .update({ name: name.trim(), plate_number: plate_number.trim().toUpperCase(), is_active: is_active !== false, odometer_unit: unit })
      .eq("id", id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  } else {
    // Create
    const { data, error } = await supabase
      .from("admin_vehicles")
      .insert({ name: name.trim(), plate_number: plate_number.trim().toUpperCase(), is_active: true, odometer_unit: unit })
      .select("id")
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true, id: data.id });
  }
}
