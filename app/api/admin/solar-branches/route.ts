import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

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

// GET — list all solar branches (active + inactive)
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("admin_solar_branches")
    .select("id, name, system_kw, is_active, created_at")
    .order("name");

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ data });
}

// POST — create or update solar branch (pass id to update)
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  if (!(await checkCanManage(auth, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const body = await request.json();
  const { id, name, system_kw, is_active } = body;

  if (!name?.trim()) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }

  const kw = system_kw != null && system_kw !== "" ? parseFloat(system_kw) : null;

  if (id) {
    const { error } = await supabase
      .from("admin_solar_branches")
      .update({ name: name.trim(), system_kw: kw, is_active: is_active !== false })
      .eq("id", id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  } else {
    const { data, error } = await supabase
      .from("admin_solar_branches")
      .insert({ name: name.trim(), system_kw: kw, is_active: true })
      .select("id")
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true, id: data.id });
  }
}
