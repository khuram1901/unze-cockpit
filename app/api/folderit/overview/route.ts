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

  // One RPC round-trip (rule 0): the DB builds the whole overview payload.
  // Also fixes a silent bug — the old code read folderit_sync_log.created_at,
  // which doesn't exist (column is ran_at), so lastSyncAt was always null.
  const { data, error } = await db.rpc("get_folderit_overview", {
    p_account_uids: visibleAccountUids,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json(data);
}
