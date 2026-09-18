import { createClient } from "@supabase/supabase-js";

export async function requireAuth(req: Request): Promise<{ email: string } | Response> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }
  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user?.email) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }
  return { email: user.email };
}

/**
 * Role helpers for API route gates (09/09/2026 access audit; three-tier
 * employee-data model per Khuram 09/09/2026):
 *   FULL employee data  — Admin/CEO, HR Managers, and members explicitly
 *                         granted can_view_hr_full_data (Ghanwa, Salman)
 *   NAMES ONLY          — the rest of the HR department
 *   NOTHING             — everyone outside HR (incl. other Managers and PA)
 *
 *   const access = await getMemberAccess(auth.email);
 *   if (!access.hrFull) return Response.json({ error: "Forbidden" }, { status: 403 });
 */
import { createServiceClient } from "./supabase-server";

export type MemberAccess = {
  role: string;
  department: string;
  /** Full employee data incl. contact details and HR financials */
  hrFull: boolean;
  /** HR department names-only tier (basic identification, no contact/financial data) */
  hrNames: boolean;
  /** Back-compat alias for hrFull — used by the hr/performance routes */
  hrDirectory: boolean;
};

export async function getMemberAccess(email: string): Promise<MemberAccess> {
  // 18/09/2026: switched from embedded join to two-step lookup — same fix as
  // api/me/permissions (09/09/2026). The embedded join
  // `member_permissions(can_view_hr_full_data)` was silently failing in
  // production: PostgREST returned {data:null, error:{...}} which the
  // original code destructured as `{ data }` (error ignored), leaving
  // role="" and department="" — hrFull=false — and every non-Admin user
  // got a 403 on every HR route. Two-step lookup is immune to this class
  // of failure.
  const db = createServiceClient();
  const { data: member, error: mErr } = await db
    .from("members")
    .select("id, role, department")
    .eq("email", email)
    .maybeSingle();
  if (mErr) console.error("getMemberAccess members lookup failed:", mErr.message);
  const role = member?.role ?? "";
  const department = member?.department ?? "";

  let override = false;
  if (member?.id) {
    const { data: perms, error: pErr } = await db
      .from("member_permissions")
      .select("can_view_hr_full_data")
      .eq("member_id", member.id)
      .maybeSingle();
    if (pErr) console.error("getMemberAccess perms lookup failed:", pErr.message);
    override = perms?.can_view_hr_full_data === true;
  }

  const hrFull =
    role === "Admin" || role === "CEO" ||
    ((role === "Manager" || role === "Director") && department === "HR") ||
    override;
  const hrNames = hrFull || department === "HR";
  return { role, department, hrFull, hrNames, hrDirectory: hrFull };
}
