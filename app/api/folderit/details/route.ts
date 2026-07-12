import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const email = (auth as { email: string }).email.toLowerCase();

  const db = createServiceClient();

  // HR category drill-down (e.g. "Policies & SOPs") — same for everyone.
  const category = request.nextUrl.searchParams.get("category");
  if (category) {
    const { data, error } = await db.rpc("get_folderit_hr_category_files", { p_category_name: category });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ items: data ?? [] });
  }

  const { data: member } = await db
    .from("members")
    .select("role, company_id")
    .eq("email", email)
    .maybeSingle();

  const isAdmin =
    email === "khuram1901@gmail.com" ||
    member?.role === "Admin" ||
    member?.role === "CEO";

  // Admins can drill into any one company via ?company=<uuid> (used by the
  // CEO all-companies view when a row is expanded). Non-admins can never
  // override their own scope, regardless of what's in the query string.
  const requestedCompany = request.nextUrl.searchParams.get("company");
  const companyUuid = isAdmin ? (requestedCompany || null) : member?.company_id ?? null;
  // Approvals are always personal — pass the caller's own email
  // unconditionally, even for Admin/CEO, so nobody's "pending approval"
  // list ever includes someone else's outstanding approvals.
  const userEmail = email;

  const { data, error } = await db.rpc("get_folderit_details", {
    p_user_email: userEmail,
    p_company_uuid: companyUuid,
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // The per-company drill-down (?company=) is company-wide by design for
  // the inbox — but approvals are personal, so a company-scoped request
  // should never surface other people's approvals just because they
  // happen to belong to that company. Only the caller's own approvals
  // stay in scope, and only via their personal (no ?company=) request.
  const items = requestedCompany ? (data ?? []).filter((row: { section: string }) => row.section !== "approval") : data ?? [];
  return Response.json({ items });
}
