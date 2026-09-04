import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { isAdmin } from "../../../lib/admin-config";


async function checkCanManage(auth: { email: string }, supabase: ReturnType<typeof createServiceClient>) {
  if (isAdmin(auth.email.toLowerCase())) return true;
  const { data: member } = await supabase.from("members").select("id").eq("email", auth.email).single();
  if (!member) return false;
  const { data: perm } = await supabase.from("member_permissions").select("can_access_admin_ops").eq("member_id", member.id).single();
  return perm?.can_access_admin_ops === true;
}

// GET — return registration grid via RPC
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("get_admin_registrations");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ data });
}

// POST — update a single registration status
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  if (!(await checkCanManage(auth, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const body = await request.json();
  const { location_id, registration_type, status, notes } = body;

  if (!location_id || !registration_type || !status) {
    return Response.json({ error: "location_id, registration_type, and status are required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("admin_registrations")
    .upsert(
      {
        location_id,
        registration_type,
        status,
        notes: notes || null,
        updated_by: auth.email,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "location_id,registration_type" }
    );

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
