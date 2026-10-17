import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { isAdmin } from "../../../lib/admin-config";

async function isAdminMember(auth: { email: string }, supabase: ReturnType<typeof createServiceClient>) {
  if (isAdmin(auth.email.toLowerCase())) return true;
  const { data: member } = await supabase.from("members").select("role").eq("email", auth.email).single();
  return member && ["admin", "ceo"].includes(member.role);
}

/** GET /api/visitors/settings — returns { ...visitor_settings, purpose_thresholds: [...] } */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const [settingsRes, thresholdsRes] = await Promise.all([
    supabase.rpc("visitor_settings_get"),
    supabase.from("visitor_purpose_thresholds").select("keyword, threshold_mins").order("keyword"),
  ]);
  if (settingsRes.error) return Response.json({ error: settingsRes.error.message }, { status: 500 });
  return Response.json({ ...settingsRes.data, purpose_thresholds: thresholdsRes.data ?? [] });
}

/** PATCH /api/visitors/settings — update visitor_settings singleton */
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

/** POST /api/visitors/settings — upsert a purpose threshold { keyword, threshold_mins } */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  if (!(await isAdminMember(auth, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const body = await request.json();
  const keyword: string = (body.keyword ?? "").trim();
  const threshold_mins: number = parseInt(body.threshold_mins, 10);

  if (!keyword || isNaN(threshold_mins) || threshold_mins < 1) {
    return Response.json({ error: "keyword and threshold_mins (>=1) are required" }, { status: 400 });
  }

  const { error } = await supabase.from("visitor_purpose_thresholds")
    .upsert({ keyword, threshold_mins }, { onConflict: "keyword" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

/** DELETE /api/visitors/settings?keyword=Interview — remove a purpose threshold */
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  if (!(await isAdminMember(auth, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const keyword = new URL(request.url).searchParams.get("keyword")?.trim();
  if (!keyword) return Response.json({ error: "keyword is required" }, { status: 400 });

  const { error } = await supabase.from("visitor_purpose_thresholds").delete().eq("keyword", keyword);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
