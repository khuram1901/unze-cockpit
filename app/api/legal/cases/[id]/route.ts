import { NextRequest } from "next/server";
import { createServiceClient } from "../../../../lib/supabase-server";
import { requireAuth } from "../../../../lib/api-auth";

const ADMIN_EMAILS = ["khuram1901@gmail.com", "k.saleem@unzegroup.com"];

async function checkCanManage(auth: { email: string }, supabase: ReturnType<typeof createServiceClient>) {
  if (ADMIN_EMAILS.includes(auth.email.toLowerCase())) return true;
  const { data: member } = await supabase
    .from("members").select("id, role").eq("email", auth.email).single();
  if (!member) return false;
  if (member.role === "Admin" || member.role === "CEO") return true;
  const { data: perm } = await supabase
    .from("member_permissions")
    .select("can_access_admin_ops")
    .eq("member_id", member.id).single();
  return perm?.can_access_admin_ops === true;
}

// GET — single case with full update log
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id } = await context.params;
  const supabase = createServiceClient();
  const { data: caseData, error: caseErr } = await supabase
    .from("legal_cases")
    .select("*")
    .eq("id", id)
    .single();
  if (caseErr) return Response.json({ error: caseErr.message }, { status: 500 });
  if (!caseData) return Response.json({ error: "Not found" }, { status: 404 });

  const { data: updates, error: updErr } = await supabase
    .from("legal_case_updates")
    .select("*")
    .eq("case_id", id)
    .order("update_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (updErr) return Response.json({ error: updErr.message }, { status: 500 });

  return Response.json({ data: { ...caseData, updates: updates || [] } });
}

// PATCH — update case fields (admin/manager: FIR number, warrant, status, resolution)
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id } = await context.params;
  const supabase = createServiceClient();
  if (!(await checkCanManage(auth, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const body = await request.json();
  // Only allow safe fields to be updated
  const allowed = [
    "status", "police_station", "fir_number", "fir_date",
    "warrant_number", "warrant_date", "court_case_number",
    "amount_recovered_pkr", "resolution_type", "resolution_notes",
    "description", "amount_involved_pkr",
  ];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }

  const { data, error } = await supabase
    .from("legal_cases")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ data });
}
