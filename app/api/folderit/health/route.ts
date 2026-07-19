/**
 * GET /api/folderit/health
 *
 * Returns filing health issues from folderit_health_issues, scoped by role:
 *  - Admin / CEO / khuram1901@gmail.com  → all companies
 *  - Manager / member                    → their company only
 *
 * Query params:
 *  company_uuid  — optional, further filter to one company (admin only)
 *  issue_type    — optional, filter by type (inbox_subfolder | buried_in_inbox |
 *                  inbox_stale | bad_filename)
 *  limit         — default 200
 *  offset        — default 0
 */

import { NextRequest } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const email = (auth as { email: string }).email.toLowerCase();

  const db = createServiceClient();

  // Determine caller's role & company
  const { data: member } = await db
    .from("members")
    .select("role, company_id")
    .eq("email", email)
    .maybeSingle();

  const isAdmin =
    email === "khuram1901@gmail.com" ||
    member?.role === "Admin" ||
    member?.role === "CEO";

  const sp = new URL(request.url).searchParams;
  const filterType = sp.get("issue_type") ?? undefined;
  const limit = Math.min(parseInt(sp.get("limit") ?? "200", 10), 500);
  const offset = parseInt(sp.get("offset") ?? "0", 10);

  let query = db
    .from("folderit_health_issues")
    .select(
      "id, account_uid, company_uuid, file_uid, file_name, issue_type, location_path, days_old, detected_at",
      { count: "exact" }
    )
    .order("detected_at", { ascending: false })
    .order("issue_type")
    .range(offset, offset + limit - 1);

  if (!isAdmin) {
    // Non-admin: restrict to their company
    if (!member?.company_id) {
      return Response.json({ issues: [], total: 0 });
    }
    // Look up the account_uid(s) for this company
    const { data: companyAccounts } = await db
      .from("folderit_account_companies")
      .select("account_uid")
      .eq("company_uuid", member.company_id);
    const accountUids = (companyAccounts ?? []).map((r: { account_uid: string }) => r.account_uid);
    if (!accountUids.length) return Response.json({ issues: [], total: 0 });
    query = query.in("account_uid", accountUids);
  } else {
    // Admin can optionally filter to a specific company
    const filterCompany = sp.get("company_uuid");
    if (filterCompany) {
      const { data: companyAccounts } = await db
        .from("folderit_account_companies")
        .select("account_uid")
        .eq("company_uuid", filterCompany);
      const accountUids = (companyAccounts ?? []).map((r: { account_uid: string }) => r.account_uid);
      if (!accountUids.length) return Response.json({ issues: [], total: 0 });
      query = query.in("account_uid", accountUids);
    }
  }

  if (filterType) {
    query = query.eq("issue_type", filterType);
  }

  const { data: issues, error, count } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ issues: issues ?? [], total: count ?? 0 });
}
