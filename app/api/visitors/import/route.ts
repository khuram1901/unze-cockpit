import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { isAdmin } from "../../../lib/admin-config";

async function isAdminMember(auth: { email: string }, supabase: ReturnType<typeof createServiceClient>) {
  if (isAdmin(auth.email.toLowerCase())) return true;
  const { data: member } = await supabase.from("members").select("role").eq("email", auth.email).single();
  return member && ["admin", "ceo"].includes(member.role.toLowerCase());
}

/** POST /api/visitors/import
 * Bulk import visitor records from historical Excel data.
 * Body: { rows: ImportRow[] }
 *
 * ImportRow shape:
 *   visit_date, visitor_name, mobile, cnic?, department_name,
 *   host_name, purpose, time_in, time_out?, comments?
 *
 * Behaviour:
 * - Case-insensitive dept + host matching against members table
 * - Unmatched host → host_member_id NULL (imported with literal host_name)
 * - Skips exact duplicates (same mobile + time_in already exists)
 * - Returns { imported, skipped, errors }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  if (!(await isAdminMember(auth, supabase))) {
    return Response.json({ error: "Not authorised" }, { status: 403 });
  }

  const { data: member } = await supabase.from("members").select("id").eq("email", auth.email).single();

  const body = await request.json();
  const { rows } = body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return Response.json({ error: "rows array required" }, { status: 400 });
  }

  // Load members once for matching
  const { data: members } = await supabase
    .from("members")
    .select("id, name, department")
    .eq("is_active", true);
  const memberMap = new Map<string, { id: string; department: string | null }>();
  for (const m of members ?? []) {
    memberMap.set((m as any).name?.toLowerCase().trim() ?? "", { id: m.id, department: m.department });
  }

  let imported = 0;
  let skipped  = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const cnicClean = row.cnic ? String(row.cnic).replace(/[-\s]/g, "") : null;
      const mobile    = String(row.mobile || "").trim();

      // Skip if duplicate (same mobile + time_in)
      const { count } = await supabase
        .from("visitor_log")
        .select("id", { count: "exact", head: true })
        .eq("mobile", mobile)
        .eq("time_in", row.time_in);
      if ((count ?? 0) > 0) { skipped++; continue; }

      // Match host
      const hostKey = String(row.host_name || "").toLowerCase().trim();
      const matched = memberMap.get(hostKey);

      await supabase.from("visitor_log").insert({
        visit_date:      row.visit_date,
        time_in:         row.time_in,
        time_out:        row.time_out || null,
        visitor_name:    String(row.visitor_name).trim(),
        mobile,
        cnic:            cnicClean || null,
        department_name: String(row.department_name || "").trim(),
        host_member_id:  matched?.id || null,
        host_name:       String(row.host_name || "").trim(),
        purpose:         String(row.purpose || "Other").trim(),
        purpose_other:   row.purpose_other || null,
        comments:        row.comments || null,
        entered_by:      member?.id || null,
      }).throwOnError();

      imported++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Row ${i + 1}: ${msg}`);
    }
  }

  return Response.json({ imported, skipped, errors });
}
