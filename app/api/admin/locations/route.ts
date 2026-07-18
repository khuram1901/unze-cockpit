import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// Check if caller is allowed to manage locations (admin email OR DB permission)
async function checkCanManage(auth: { email: string }, supabase: ReturnType<typeof createServiceClient>) {
  if (auth.email.toLowerCase() === "khuram1901@gmail.com") return true;
  const { data: member } = await supabase
    .from("members").select("id").eq("email", auth.email).single();
  if (!member) return false;
  const { data: perm } = await supabase
    .from("member_permissions").select("can_manage_locations").eq("member_id", member.id).single();
  return perm?.can_manage_locations === true;
}

// POST — create a new location + all linked records via RPC
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const {
    name, entity, location_type, province,
    eobi_status, ss_status,
    civil_defence_status, civil_defence_registered, civil_defence_due,
    labour_reg_status, labour_insp_status,
    ntn_number, meter_label,
  } = body;

  if (!name?.trim() || !entity || !location_type) {
    return Response.json({ error: "name, entity, and location_type are required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  if (!(await checkCanManage(auth, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const { data, error } = await supabase.rpc("create_admin_location_full", {
    p_name:                     name.trim(),
    p_entity:                   entity,
    p_location_type:            location_type,
    p_province:                 province || "",
    p_eobi_status:              eobi_status || "Pending",
    p_ss_status:                ss_status || "Pending",
    p_civil_defence_status:     civil_defence_status || "Pending",
    p_civil_defence_registered: civil_defence_registered || null,
    p_civil_defence_due:        civil_defence_due || null,
    p_labour_reg_status:        labour_reg_status || "Pending",
    p_labour_insp_status:       labour_insp_status || "Pending",
    p_ntn_number:               ntn_number || null,
    p_meter_label:              meter_label || null,
    p_created_by:               auth.email,
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, location_id: data });
}

// DELETE — soft-delete a location (set is_active = false)
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const location_id = searchParams.get("id");
  if (!location_id) return Response.json({ error: "id is required" }, { status: 400 });

  const supabase = createServiceClient();

  if (!(await checkCanManage(auth, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const { error } = await supabase
    .from("admin_locations")
    .update({ is_active: false })
    .eq("id", location_id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
