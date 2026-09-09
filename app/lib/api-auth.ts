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
 * Role helpers for API route gates (09/09/2026 access audit).
 * Fetches the caller's role + department once; use the predicates to gate.
 *   const gate = await getMemberAccess(auth.email);
 *   if (!gate.hrDirectory) return Response.json({ error: "Forbidden" }, { status: 403 });
 */
import { createServiceClient } from "./supabase-server";

export type MemberAccess = {
  role: string;
  department: string;
  /** Employee directory / workforce data: management roles + HR department */
  hrDirectory: boolean;
  /** Financial HR data (salaries, advances, PF): Admin/CEO + HR/Finance Managers — never PA */
  hrFinancial: boolean;
};

export async function getMemberAccess(email: string): Promise<MemberAccess> {
  const db = createServiceClient();
  const { data } = await db
    .from("members")
    .select("role, department")
    .eq("email", email)
    .maybeSingle();
  const role = data?.role ?? "";
  const department = data?.department ?? "";
  return {
    role,
    department,
    hrDirectory:
      role === "Admin" || role === "CEO" || role === "Manager" ||
      role === "Executive" || department === "HR",
    hrFinancial:
      role === "Admin" || role === "CEO" ||
      (role === "Manager" && (department === "HR" || department === "Finance")),
  };
}
