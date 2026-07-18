import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// POST — create a new location
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const { name, entity, location_type, province } = body;

  if (!name?.trim() || !entity || !location_type) {
    return Response.json({ error: "name, entity, and location_type are required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Verify caller has can_manage_locations
  const { data: perm } = await supabase
    .from("member_permissions")
    .select("can_manage_locations")
    .eq("member_id", (
      await supabase.from("members").select("id").eq("email", auth.email).single()
    ).data?.id)
    .single();

  if (!perm?.can_manage_locations) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("admin_locations")
    .insert({ name: name.trim(), entity, location_type, province: province || null, is_active: true })
    .select("id, name")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, location: data });
}

// DELETE — soft-delete a location (set is_active = false)
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const location_id = searchParams.get("id");
  if (!location_id) return Response.json({ error: "id is required" }, { status: 400 });

  const supabase = createServiceClient();

  // Verify caller has can_manage_locations
  const { data: member } = await supabase
    .from("members")
    .select("id")
    .eq("email", auth.email)
    .single();

  const { data: perm } = await supabase
    .from("member_permissions")
    .select("can_manage_locations")
    .eq("member_id", member?.id)
    .single();

  if (!perm?.can_manage_locations) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const { error } = await supabase
    .from("admin_locations")
    .update({ is_active: false })
    .eq("id", location_id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
