import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { isAdmin } from "../../../lib/admin-config";

async function isAdminMember(auth: { email: string }, supabase: ReturnType<typeof createServiceClient>) {
  if (isAdmin(auth.email.toLowerCase())) return true;
  const { data: member } = await supabase.from("members").select("role").eq("email", auth.email).single();
  return member && ["admin", "ceo"].includes(member.role);
}

/** GET /api/visitors/settings */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("visitor_settings_get");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

/** PATCH /api/visitors/settings */
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  if (!(await isAdminMember(auth, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const { data: member } = await supabase.from("members").select("id").eq("email", auth.email).single();
  const body = await request.json();
  const { overstay_threshold_mins, office_open_hour, office_close_hour, weekly_digest_email } = body;

  const { error } = await supabase.from("visitor_settings").update({
    ...(overstay_threshold_mins != null && { overstay_threshold_mins }),
    ...(office_open_hour        != null && { office_open_hour }),
    ...(office_close_hour       != null && { office_close_hour }),
    ...(weekly_digest_email     != null && { weekly_digest_email }),
    updated_at: new Date().toISOString(),
    updated_by: member?.id || null,
  }).eq("id", 1);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
