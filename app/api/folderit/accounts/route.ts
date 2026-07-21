import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { resolveFolderitAccess } from "../../../lib/folderit-access";

// Returns the list of Folderit accounts the current user can browse,
// with company names resolved. Used by the Browse tab to populate the
// account/company selector.
//
// Admin/CEO: all active non-excluded accounts.
// HR grant: HR cabinet only.
// Everyone else: own company's cabinet(s) + Access Matrix company grants.

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const email = (auth as { email: string }).email.toLowerCase();

  const db = createServiceClient();

  const access = await resolveFolderitAccess(db, email);

  // Fetch the relevant account UIDs
  let accountUids: string[] = [];

  if (access.accountUids === null) {
    const { data: allAccounts } = await db
      .from("folderit_account_map")
      .select("account_uid")
      .eq("is_active", true)
      .neq("scope", "excluded");
    accountUids = (allAccounts ?? []).map((r) => r.account_uid);
  } else {
    accountUids = access.accountUids;
  }

  if (!accountUids.length) {
    return Response.json({ accounts: [] });
  }

  // Fetch account names + company links in parallel (small datasets)
  const [{ data: accountMaps }, { data: companyLinks }] = await Promise.all([
    db
      .from("folderit_account_map")
      .select("account_uid, account_name")
      .in("account_uid", accountUids),
    db
      .from("folderit_account_companies")
      .select("account_uid, company_uuid, companies(id, name, short_code)")
      .in("account_uid", accountUids),
  ]);

  // Build the response — one entry per account_uid
  const nameMap = new Map((accountMaps ?? []).map((r) => [r.account_uid, r.account_name]));
  const companyMap = new Map(
    (companyLinks ?? []).map((r) => [
      r.account_uid,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      r.companies as any,
    ])
  );

  const accounts = accountUids.map((uid) => ({
    account_uid: uid,
    account_name: nameMap.get(uid) ?? uid,
    company: companyMap.get(uid) ?? null,
  }));

  return Response.json({ accounts });
}
