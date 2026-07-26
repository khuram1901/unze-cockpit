import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// Who can READ: anyone with admin_ops, admin_entry, or HR access — checked at page level.
// Who can CREATE: admin tier + HR (checked here loosely — page guards handle the rest).
async function checkCanCreate(auth: { email: string }, supabase: ReturnType<typeof createServiceClient>) {
  const ADMIN_EMAILS = ["khuram1901@gmail.com", "k.saleem@unzegroup.com"];
  if (ADMIN_EMAILS.includes(auth.email.toLowerCase())) return true;
  const { data: member } = await supabase
    .from("members").select("id, role, department").eq("email", auth.email).maybeSingle();
  if (!member) return false;
  if (member.role === "Admin" || member.role === "CEO") return true;
  if (member.department === "HR" || member.department === "Human Resources") return true;
  const { data: perm } = await supabase
    .from("member_permissions")
    .select("can_access_admin_ops")
    .eq("member_id", member.id).maybeSingle();
  return perm?.can_access_admin_ops === true;
}

// GET — list cases, optional filters: ?entity=IFPL&status=Open
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const entity = searchParams.get("entity");
  const status = searchParams.get("status");

  const supabase = createServiceClient();
  let query = supabase
    .from("legal_cases")
    .select("id, case_number, entity, location_name, subject_name, subject_role, offence_type, status, incident_date, amount_involved_pkr, fir_number, warrant_number, court_case_number, police_station, initiated_by, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (entity) query = query.eq("entity", entity);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ data });
}

// POST — create a new legal case (HR initiates)
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  if (!(await checkCanCreate(auth, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const body = await request.json();
  const {
    entity, location_id, location_name, subject_name, subject_role, subject_employee_id,
    offence_type, description, incident_date, amount_involved_pkr, police_station,
  } = body;

  if (!entity || !location_name || !subject_name || !offence_type) {
    return Response.json({ error: "entity, location_name, subject_name and offence_type are required" }, { status: 400 });
  }

  // Generate case number: LC-YYYY-NNN
  const year = new Date().getFullYear();
  // Count existing cases this year to generate sequence number
  const { count } = await supabase
    .from("legal_cases")
    .select("id", { count: "exact", head: true })
    .gte("created_at", `${year}-01-01`);
  const seq = ((count ?? 0) + 1).toString().padStart(3, "0");
  const case_number = `LC-${year}-${seq}`;

  const { data, error } = await supabase
    .from("legal_cases")
    .insert({
      case_number,
      entity,
      location_id: location_id || null,
      location_name,
      subject_name,
      subject_role: subject_role || null,
      subject_employee_id: subject_employee_id || null,
      offence_type,
      description: description || null,
      incident_date: incident_date || null,
      amount_involved_pkr: amount_involved_pkr ?? null,
      police_station: police_station || null,
      status: "HR Documents Issued",
      initiated_by: auth.email,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ data });
}
