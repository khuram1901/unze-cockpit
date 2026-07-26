import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// Who can add updates: admin + admin_ops + admin_entry (field team)
async function checkCanUpdate(auth: { email: string }, supabase: ReturnType<typeof createServiceClient>) {
  const ADMIN_EMAILS = ["khuram1901@gmail.com", "k.saleem@unzegroup.com"];
  if (ADMIN_EMAILS.includes(auth.email.toLowerCase())) return true;
  const { data: member } = await supabase
    .from("members").select("id, role, department").eq("email", auth.email).maybeSingle();
  if (!member) return false;
  if (member.role === "Admin" || member.role === "CEO") return true;
  if (member.department === "HR" || member.department === "Human Resources") return true;
  const { data: perm } = await supabase
    .from("member_permissions")
    .select("can_access_admin_ops, can_access_admin_entry")
    .eq("member_id", member.id).maybeSingle();
  return perm?.can_access_admin_ops === true || perm?.can_access_admin_entry === true;
}

// POST — log a follow-up action and optionally advance the case status
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  if (!(await checkCanUpdate(auth, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const body = await request.json();
  const {
    case_id, update_type, update_date, description,
    status_after, fir_number, warrant_number, court_case_number,
    next_action, next_action_date,
  } = body;

  if (!case_id || !update_type || !description) {
    return Response.json({ error: "case_id, update_type and description are required" }, { status: 400 });
  }

  // Fetch current status for the log
  const { data: caseRow } = await supabase
    .from("legal_cases").select("status").eq("id", case_id).single();
  const status_before = caseRow?.status ?? null;

  // Insert update record
  const { data: updateRow, error: updErr } = await supabase
    .from("legal_case_updates")
    .insert({
      case_id,
      update_type,
      update_date: update_date || new Date().toISOString().slice(0, 10),
      description,
      status_before,
      status_after: status_after || null,
      fir_number: fir_number || null,
      warrant_number: warrant_number || null,
      court_case_number: court_case_number || null,
      next_action: next_action || null,
      next_action_date: next_action_date || null,
      entered_by: auth.email,
    })
    .select()
    .single();

  if (updErr) return Response.json({ error: updErr.message }, { status: 500 });

  // Advance case status + capture reference numbers if provided
  const caseUpdate: Record<string, unknown> = {};
  if (status_after && status_after !== status_before) caseUpdate.status = status_after;
  if (fir_number) caseUpdate.fir_number = fir_number;
  if (warrant_number) caseUpdate.warrant_number = warrant_number;
  if (court_case_number) caseUpdate.court_case_number = court_case_number;

  if (Object.keys(caseUpdate).length > 0) {
    await supabase.from("legal_cases").update(caseUpdate).eq("id", case_id);
  }

  return Response.json({ data: updateRow });
}
