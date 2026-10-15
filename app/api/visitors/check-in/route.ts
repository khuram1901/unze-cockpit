import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

/** POST /api/visitors/check-in
 * Creates a new visitor_log entry.
 * Sends bell notification to admin/security.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();

  // Resolve member ID for entered_by
  const { data: member } = await supabase
    .from("members")
    .select("id, name")
    .eq("email", auth.email)
    .single();
  if (!member) return Response.json({ error: "Member not found" }, { status: 403 });

  const body = await request.json();
  const {
    visit_date, visitor_name, mobile, cnic,
    department_name, host_member_id, host_name,
    purpose, purpose_other, comments, time_in,
  } = body;

  // Basic validation
  if (!visit_date || !visitor_name || !mobile || !department_name || !host_name || !purpose) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Normalise CNIC (strip dashes, ensure 13 digits)
  const cnicClean = cnic ? cnic.replace(/[-\s]/g, "") : null;
  if (cnicClean && !/^\d{13}$/.test(cnicClean)) {
    return Response.json({ error: "CNIC must be 13 digits" }, { status: 400 });
  }

  // Normalise mobile: must be +923XXXXXXXXX (11 digits after +92)
  if (!/^\+923\d{9}$/.test(mobile)) {
    return Response.json({ error: "Mobile must be +923XXXXXXXXX format" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase.from("visitor_log").insert({
    visit_date,
    time_in:         time_in || now,
    visitor_name:    visitor_name.trim(),
    mobile,
    cnic:            cnicClean,
    department_name: department_name.trim(),
    host_member_id:  host_member_id || null,
    host_name:       host_name.trim(),
    purpose,
    purpose_other:   purpose_other || null,
    comments:        comments || null,
    entered_by:      member.id,
  }).select("id").single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Bell notification — insert into notifications table (non-fatal)
  try {
    await supabase.from("notifications").insert({
      type:        "visitor_checkin",
      title:       "Visitor Arrived",
      body:        `${visitor_name} is here to meet ${host_name} (${department_name}).`,
      target_role: "admin",
      created_at:  now,
    });
  } catch { /* notifications table may not exist yet — ignore */ }

  return Response.json({ id: data.id });
}
