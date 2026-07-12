import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { folderitFetch } from "../../../lib/folderit-auth";

const CRON_SECRET = process.env.CRON_SECRET;

type AccountMapRow = {
  account_uid: string;
  account_name: string;
  scope: string;
  inbox_folder_uid: string | null;
};

type FolderitFile = {
  uid: string;
  name: string;
  createdAt?: number;
  entityUid?: string;
  approvalStatus?: "active" | "inProgress" | "approved" | "rejected" | "deleted" | null;
};

type FolderitResolution = {
  uid: string;
  entityUid: string;
  status: "preparing" | "active" | "inProgress" | "complete" | "rejected";
};

type FolderitResolutionInvite = {
  uid: string;
  email: string;
  status: "pending" | "pendingInvite" | "active" | "approved" | "rejected";
  order?: number;
};

// How far back to scan for files that might be mid-approval. Keeps the sync
// job cheap — old, already-resolved documents don't need re-checking.
const APPROVAL_SCAN_DAYS = 180;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const isCron = CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`;
  if (!isCron) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = createServiceClient();
  const errors: string[] = [];
  let inboxSynced = 0;
  let invitesSynced = 0;

  const { data: accounts, error: accountsErr } = await db
    .from("folderit_account_map")
    .select("account_uid, account_name, scope, inbox_folder_uid")
    .eq("is_active", true)
    .neq("scope", "excluded")
    .neq("scope", "pending");

  if (accountsErr || !accounts?.length) {
    return Response.json({ error: accountsErr?.message ?? "No active Folderit accounts mapped" }, { status: 500 });
  }

  for (const account of accounts as AccountMapRow[]) {
    // ── 1. Inbox files: whatever is still sitting in the mail-in folder ──
    if (account.inbox_folder_uid) {
      try {
        const res = await folderitFetch(
          `/v2/accounts/${account.account_uid}/folders/${account.inbox_folder_uid}/files?limit=200`
        );
        if (!res.ok) {
          errors.push(`${account.account_name}: inbox fetch ${res.status}`);
        } else {
          const json = await res.json();
          const files: FolderitFile[] = json.files ?? json ?? [];

          // Replace this account's inbox snapshot wholesale — simplest way
          // to drop files that have since been filed elsewhere.
          await db.from("folderit_inbox_files").delete().eq("account_uid", account.account_uid);

          if (files.length) {
            const rows = files.map((f) => ({
              file_uid: f.uid,
              account_uid: account.account_uid,
              name: f.name,
              created_at: f.createdAt ? new Date(f.createdAt * 1000).toISOString() : null,
              synced_at: new Date().toISOString(),
            }));
            const { error: upsertErr } = await db.from("folderit_inbox_files").upsert(rows);
            if (upsertErr) errors.push(`${account.account_name}: inbox upsert — ${upsertErr.message}`);
            else inboxSynced += rows.length;
          }
        }
      } catch (e) {
        errors.push(`${account.account_name}: inbox fetch error — ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // ── 2. Approval invites: shortlist recently-touched files still mid-approval ──
    try {
      const dateFrom = new Date(Date.now() - APPROVAL_SCAN_DAYS * 86400_000).toISOString().slice(0, 10);
      const res = await folderitFetch(
        `/v2/accounts/${account.account_uid}/search/files?dateFrom=${dateFrom}&limit=200`
      );
      if (!res.ok) {
        errors.push(`${account.account_name}: file search ${res.status}`);
        continue;
      }
      const json = await res.json();
      const files: FolderitFile[] = json.files ?? [];
      const inProgress = files.filter((f) => f.approvalStatus === "active" || f.approvalStatus === "inProgress");

      const currentInviteUids: string[] = [];

      for (const file of inProgress) {
        if (!file.entityUid) continue;
        const resResolutions = await folderitFetch(
          `/v2/accounts/${account.account_uid}/entities/${file.entityUid}/resolutions`
        );
        if (!resResolutions.ok) continue;
        const resolutionsJson = await resResolutions.json();
        const resolutions: FolderitResolution[] = resolutionsJson.resolutions ?? resolutionsJson ?? [];

        for (const resolution of resolutions) {
          if (resolution.status !== "active" && resolution.status !== "inProgress") continue;
          const resInvites = await folderitFetch(
            `/v2/accounts/${account.account_uid}/resolutions/${resolution.uid}/invites`
          );
          if (!resInvites.ok) continue;
          const invitesJson = await resInvites.json();
          const invites: FolderitResolutionInvite[] = invitesJson.invites ?? invitesJson ?? [];

          for (const invite of invites) {
            currentInviteUids.push(invite.uid);
            const { error: upsertErr } = await db.from("folderit_resolution_invites").upsert({
              invite_uid: invite.uid,
              resolution_uid: resolution.uid,
              file_uid: file.uid,
              entity_uid: file.entityUid,
              account_uid: account.account_uid,
              email: invite.email,
              status: invite.status,
              invite_order: invite.order ?? null,
              synced_at: new Date().toISOString(),
            });
            if (upsertErr) errors.push(`${account.account_name}: invite upsert — ${upsertErr.message}`);
            else invitesSynced += 1;
          }
        }
      }

      // Drop stale invites for this account that weren't seen this run
      // (resolved/cancelled since last sync).
      if (currentInviteUids.length) {
        await db
          .from("folderit_resolution_invites")
          .delete()
          .eq("account_uid", account.account_uid)
          .not("invite_uid", "in", `(${currentInviteUids.map((u) => `"${u}"`).join(",")})`);
      } else {
        await db.from("folderit_resolution_invites").delete().eq("account_uid", account.account_uid);
      }
    } catch (e) {
      errors.push(`${account.account_name}: approval sync error — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return Response.json({
    ok: errors.length === 0,
    accountsSynced: accounts.length,
    inboxFilesSynced: inboxSynced,
    invitesSynced,
    errors,
  });
}
