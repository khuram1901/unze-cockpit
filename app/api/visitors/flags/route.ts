import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { isAdmin } from "../../../lib/admin-config";

async function isAdminMember(auth: { email: string }, supabase: ReturnType<typeof createServiceClient>) {
  if (isAdmin(auth.email.toLowerCase())) return true;
  const { data: member } = await supabase.from("members").select("role").eq("email", auth.email).single();
  return member && ["admin", "ceo"].includes(member.role.toLowerCase());
}

/** GET /api/visitors/flags?cnic=<13digits> */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  if (!(await isAdminMember(auth, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const cnic = request.nextUrl.searchParams.get("cnic");
  if (!cnic) return Response.json({ error: "cnic required" }, { status: 400 });

  const { data, error } = await supabase
    .from("visitor_flags")
    .select("*")
    .eq("cnic", cnic.replace(/[-\s]/g, ""));
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ flags: data });
}

/** POST /api/visitors/flags — add flag */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  if (!(await isAdminMember(auth, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const { data: member } = await supabase.from("members").select("id").eq("email", auth.email).single();
  const body = await request.json();
  const { cnic, flag_type, reason } = body;
  if (!cnic || !flag_type) return Response.json({ error: "cnic and flag_type required" }, { status: 400 });
  if (!["vip","blacklist"].includes(flag_type)) return Response.json({ error: "flag_type must be vip or blacklist" }, { status: 400 });

  const { error } = await supabase.from("visitor_flags").upsert({
    cnic: cnic.replace(/[-\s]/g, ""),
    flag_type,
    reason: reason || null,
    created_by: member?.id || null,
  }, { onConflict: "cnic,flag_type" });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

/** DELETE /api/visitors/flags */
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  if (!(await isAdminMember(auth, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const body = await request.json();
  const { cnic, flag_type } = body;
  if (!cnic) return Response.json({ error: "cnic required" }, { status: 400 });

  let builder = supabase.from("visitor_flags").delete().eq("cnic", cnic.replace(/[-\s]/g, ""));
  if (flag_type) builder = builder.eq("flag_type", flag_type);

  const { error } = await builder;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
