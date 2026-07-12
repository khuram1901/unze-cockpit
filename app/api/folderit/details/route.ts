import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { canViewFolderitHr } from "../../../lib/permissions";
import { loadFolderitUserCtx } from "../_shared";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const email = (auth as { email: string }).email.toLowerCase();

  const db = createServiceClient();

  // HR category drill-down (e.g. "Policies & SOPs") — locked behind
  // can_view_folderit_hr, off by default for everyone except Admin/CEO.
  const category = request.nextUrl.searchParams.get("category");
  if (category) {
    const ctx = await loadFolderitUserCtx(db, email);
    if (!canViewFolderitHr(ctx)) return Response.json({ error: "Forbidden" }, { status: 403 });

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

  // An admin's personal (no ?company=) request only ever wants their own
  // approvals — never a company_inbox blob. Without this, p_company_uuid
  // being null for an admin used to mean "no filter", so this call
  // silently fetched and transferred EVERY company's entire unfiled
  // inbox on every page load just to discard it client-side. Non-admins
  // are unaffected — their company_inbox is always meaningfully scoped
  // to their own company_id, never null.
  const includeCompanyInbox = !isAdmin || !!requestedCompany;

  const { data, error } = await db.rpc("get_folderit_details", {
    p_user_email: userEmail,
    p_company_uuid: companyUuid,
    p_include_company_inbox: includeCompanyInbox,
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
