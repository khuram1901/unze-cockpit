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
import { resolveFolderitAccess } from "../../../lib/folderit-access";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const email = (auth as { email: string }).email.toLowerCase();

  const db = createServiceClient();

  const access = await resolveFolderitAccess(db, email);
  if (access.accountUids !== null && access.accountUids.length === 0) {
    return Response.json({ issues: [], total: 0 });
  }

  const sp = new URL(request.url).searchParams;
  const filterType = sp.get("issue_type") ?? undefined;
  const limit = Math.min(parseInt(sp.get("limit") ?? "200", 10), 500);
  const offset = parseInt(sp.get("offset") ?? "0", 10);

  let query = db
    .from("folderit_health_issues")
    .select(
      "id, account_uid, company_uuid, file_uid, file_name, issue_type, location_path, days_old, detected_at, companies(name)",
      { count: "exact" }
    )
    .order("issue_type")
    .order("days_old", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  // Scope to the user's visible cabinets (null = admin, sees all)
  if (access.accountUids !== null) {
    query = query.in("account_uid", access.accountUids);
  }

  // Optional filter to one company — applies within the visible set, so
  // it's safe for any role (a non-admin filtering a company they can't
  // see just intersects to nothing).
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

  if (filterType) {
    query = query.eq("issue_type", filterType);
  }

  const { data: rawIssues, error, count } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Flatten the companies join so the frontend gets a plain company_name string
  const issues = (rawIssues ?? []).map((iss) => {
    const co = iss.companies as { name: string } | { name: string }[] | null;
    const company_name = Array.isArray(co) ? (co[0]?.name ?? null) : (co?.name ?? null);
    const { companies: _drop, ...rest } = iss as typeof iss & { companies: unknown };
    return { ...rest, company_name };
  });

  return Response.json({ issues, total: count ?? 0 });
}
