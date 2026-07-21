import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { loadFolderitUserCtx } from "../_shared";
import { isAdminTier, folderitGrantedShortCodes } from "../../../lib/permissions";
import {
  UTPL_COMPANY_ID, IFPL_COMPANY_ID,
  BRNH_COMPANY_ID, HD_COMPANY_ID,
  SMI_COMPANY_ID, UZL_COMPANY_ID, DIR_COMPANY_ID,
} from "../../../lib/constants";

// Map short code → one or more company UUIDs (RST merges two DB companies).
const SC_TO_UUIDS: Record<string, string[]> = {
  UTPL: [UTPL_COMPANY_ID],
  IFPL: [IFPL_COMPANY_ID],
  RST:  [BRNH_COMPANY_ID, HD_COMPANY_ID],
  SMI:  [SMI_COMPANY_ID],
  UZL:  [UZL_COMPANY_ID],
  DIR:  [DIR_COMPANY_ID],
};

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const email = (auth as { email: string }).email.toLowerCase();

  const db = createServiceClient();
  const ctx = await loadFolderitUserCtx(db, email);
  const admin = isAdminTier(ctx);

  // Non-admin users need at least one explicit company grant to reach here.
  const grantedCodes = folderitGrantedShortCodes(ctx);
  if (!admin && grantedCodes.length === 0) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await db.rpc("get_folderit_company_breakdown");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let companies = data ?? [];

  // Non-admins: filter the RPC results to only their allowed companies.
  if (!admin) {
    const allowedUuids = new Set(
      grantedCodes.flatMap((sc) => SC_TO_UUIDS[sc] ?? [])
    );
    companies = companies.filter(
      (row: { group_key: string }) => allowedUuids.has(row.group_key)
    );
  }

  return Response.json({ companies });
}
