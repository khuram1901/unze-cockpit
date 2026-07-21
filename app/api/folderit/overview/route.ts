/**
 * GET /api/folderit/overview
 *
 * Returns a summary of Folderit data for the Overview tab:
 *   accounts          — list of accounts the user can see
 *   healthSummary     — per-company issue counts + health score
 *   lastSyncAt        — timestamp of most recent sync run
 *   inboxFilesTotal   — total files currently in all inboxes the user can see
 *   issueBreakdown    — { inbox_subfolder, buried_in_inbox, inbox_stale, bad_filename }
 *
 * Role-scoped the same way as /api/folderit/health.
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

  // --- Determine which account_uids this user may see ---
  // (own company + Access Matrix grants; HR grant → HR cabinet only;
  //  admin → all. See lib/folderit-access.ts.)
  const access = await resolveFolderitAccess(db, email);
  const visibleAccountUids = access.accountUids; // null = all

  if (visibleAccountUids !== null && visibleAccountUids.length === 0) {
    return Response.json({
      accounts: [],
      healthSummary: [],
      lastSyncAt: null,
      inboxFilesTotal: 0,
      issueBreakdown: { inbox_subfolder: 0, buried_in_inbox: 0, inbox_stale: 0, bad_filename: 0 },
    });
  }

  // Run all queries in parallel
  let accountQuery = db
    .from("folderit_account_map")
    .select("account_uid, account_name, scope")
    .eq("is_active", true)
    .neq("scope", "excluded")
    .neq("scope", "pending");

  if (visibleAccountUids) {
    accountQuery = accountQuery.in("account_uid", visibleAccountUids);
  }

  let issueQuery = db
    .from("folderit_health_issues")
    .select("account_uid, issue_type");

  if (visibleAccountUids) {
    issueQuery = issueQuery.in("account_uid", visibleAccountUids);
  }

  let inboxQuery = db
    .from("folderit_inbox_files")
    .select("account_uid", { count: "exact", head: true });

  if (visibleAccountUids) {
    inboxQuery = inboxQuery.in("account_uid", visibleAccountUids);
  }

  const [
    { data: accounts },
    { data: issues },
    { count: inboxTotal },
    { data: syncLog },
    { data: companyLinks },
  ] = await Promise.all([
    accountQuery,
    issueQuery,
    inboxQuery,
    db
      .from("folderit_sync_log")
      .select("created_at, ok, health_issues_found")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("folderit_account_companies")
      .select("account_uid, company_uuid, companies(id, name)"),
  ]);

  // Build a lookup: account_uid → { company_uuid, company_name }
  // Supabase returns the joined relation as an array when using select("companies(id,name)")
  type CompanyLink = { account_uid: string; company_uuid: string; companies: { id: string; name: string }[] | { id: string; name: string } | null };
  const accountToCompany = new Map<string, { uuid: string; name: string }>();
  for (const link of ((companyLinks ?? []) as unknown as CompanyLink[])) {
    const co = Array.isArray(link.companies) ? link.companies[0] : link.companies;
    accountToCompany.set(link.account_uid, {
      uuid: link.company_uuid,
      name: co?.name ?? "Unknown",
    });
  }

  // Build issue breakdown
  const breakdown = {
    inbox_subfolder: 0,
    buried_in_inbox: 0,
    inbox_stale: 0,
    bad_filename: 0,
  } as Record<string, number>;
  const issuesByCompany = new Map<string, Record<string, number>>();

  for (const issue of issues ?? []) {
    breakdown[issue.issue_type] = (breakdown[issue.issue_type] ?? 0) + 1;
    const co = accountToCompany.get(issue.account_uid);
    if (co) {
      const bucket = issuesByCompany.get(co.uuid) ?? {};
      bucket[issue.issue_type] = (bucket[issue.issue_type] ?? 0) + 1;
      issuesByCompany.set(co.uuid, bucket);
    }
  }

  // Build per-company health summary
  // Health score: start at 100. Each unique issue subtracts points.
  // inbox_subfolder = 10 pts, buried_in_inbox = 3 pts, inbox_stale = 5 pts, bad_filename = 2 pts
  const WEIGHTS: Record<string, number> = {
    inbox_subfolder: 10,
    buried_in_inbox: 3,
    inbox_stale: 5,
    bad_filename: 2,
  };
  const seenCompanies = new Map<string, string>(); // uuid → name
  for (const link of ((companyLinks ?? []) as unknown as CompanyLink[])) {
    if (!visibleAccountUids || visibleAccountUids.includes(link.account_uid)) {
      const co = Array.isArray(link.companies) ? link.companies[0] : link.companies;
      if (co) seenCompanies.set(co.id, co.name);
    }
  }

  const healthSummary = Array.from(seenCompanies.entries()).map(([uuid, name]) => {
    const issueCounts = issuesByCompany.get(uuid) ?? {};
    const totalDeduction = Object.entries(issueCounts).reduce(
      (sum, [type, count]) => sum + (WEIGHTS[type] ?? 1) * count,
      0
    );
    const score = Math.max(0, 100 - totalDeduction);
    return {
      company_uuid: uuid,
      company_name: name,
      score,
      total_issues: Object.values(issueCounts).reduce((a, b) => a + b, 0),
      breakdown: issueCounts,
    };
  });

  return Response.json({
    accounts: accounts ?? [],
    healthSummary,
    lastSyncAt: syncLog?.created_at ?? null,
    lastSyncOk: syncLog?.ok ?? null,
    inboxFilesTotal: inboxTotal ?? 0,
    issueBreakdown: breakdown,
  });
}
