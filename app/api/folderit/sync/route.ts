import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { folderitFetch, folderitGetWithBody } from "../../../lib/folderit-auth";

export const maxDuration = 60; // Vercel Pro ceiling — accounts sync in parallel below

const CRON_SECRET = process.env.CRON_SECRET;

type AccountMapRow = {
  account_uid: string;
  account_name: string;
  scope: string;
  inbox_folder_uid: string | null;
};

type HrCategoryRow = {
  category_name: string;
  account_uid: string;
  folder_uid: string;
};

type FolderitFile = {
  uid: string;
  name: string;
  createdAt?: number;
  // "/"-joined breadcrumb of subfolder names relative to the category's
  // root folder (e.g. "01-Archive/2019"), or undefined for files sitting
  // directly in the root. Only populated for HR category files — see
  // fetchFolderFilesRecursive.
  folderPath?: string;
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
  createdAt?: number; // unix seconds, same convention as FolderitFile.createdAt
};

type AuditEntry = {
  event: string;
  entityUid: string; // the file's own uid, per Folderit's audit trail schema
};

// How many recent audit-trail pages to scan per account for approval
// activity. Folderit's search/files endpoint does NOT return approvalStatus
// (confirmed against the OpenAPI schema — the default search result shape
// has no approval fields, only the "expanded" variant would, and search
// doesn't support requesting it). The reliable way to discover which files
// are mid-approval is the account's audit trail, which logs a
// "fileResolutionNew" event exactly when an approval starts. We scan recent
// pages of that log to discover candidate files, then ask the live
// resolutions/invites endpoints for their current status (never trusting
// the audit log itself for current state, only for discovery).
//
// IMPORTANT: this MUST call GET /audit/accountLog, not GET /audit. The
// plain /audit endpoint's response schema (auditTrailAccountEntry) is a
// closed set of 50 account-level event types that structurally can never
// include "fileResolutionNew" — confirmed against the OpenAPI spec, this is
// why invitesSynced was always 0 even with real pending approvals. The
// correct endpoint's schema is a union across file/folder/account entries,
// and file entries do include fileResolutionNew.
//
// /audit/accountLog also takes its filters (type, event, time) as a JSON
// body on a GET request — see folderitGetWithBody() for why that needs
// Node's raw https client instead of fetch(). Without an explicit `time`,
// Folderit defaults to only the last 1 day (max 30), which alone could
// explain missed approvals older than that.
const AUDIT_PAGES_TO_SCAN = 3;
const AUDIT_PER_PAGE = 500;
const AUDIT_LOOKBACK_DAYS = 30; // Folderit's documented max for this endpoint

async function syncAccountInbox(
  db: ReturnType<typeof createServiceClient>,
  account: AccountMapRow
): Promise<{ inboxSynced: number; errors: string[] }> {
  const errors: string[] = [];
  let inboxSynced = 0;

  if (!account.inbox_folder_uid) return { inboxSynced, errors };

  try {
    const res = await folderitFetch(
      `/v2/accounts/${account.account_uid}/folders/${account.inbox_folder_uid}/files?per-page=500`
    );
    if (!res.ok) {
      errors.push(`${account.account_name}: inbox fetch ${res.status}`);
      return { inboxSynced, errors };
    }
    const json = await res.json();
    const files: FolderitFile[] = json.files ?? json ?? [];

    // Replace this account's inbox snapshot wholesale — simplest way to
    // drop files that have since been filed elsewhere.
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
      else inboxSynced = rows.length;
    }
  } catch (e) {
    errors.push(`${account.account_name}: inbox fetch error — ${e instanceof Error ? e.message : String(e)}`);
  }

  return { inboxSynced, errors };
}

async function syncAccountApprovals(
  db: ReturnType<typeof createServiceClient>,
  account: AccountMapRow
): Promise<{ invitesSynced: number; errors: string[]; auditEntriesScanned: number; candidatesFound: number; sampleEvents: string[] }> {
  const errors: string[] = [];
  let invitesSynced = 0;
  let auditEntriesScanned = 0;
  const sampleEvents = new Set<string>(); // distinct event types seen, for debugging shape assumptions

  try {
    const candidateEntityUids = new Set<string>();
    const sinceUnix = Math.floor(Date.now() / 1000) - AUDIT_LOOKBACK_DAYS * 24 * 60 * 60;
    for (let page = 1; page <= AUDIT_PAGES_TO_SCAN; page++) {
      const auditRes = await folderitGetWithBody(
        `/v2/accounts/${account.account_uid}/audit/accountLog?page=${page}&per-page=${AUDIT_PER_PAGE}`,
        { type: ["file"], event: ["fileResolutionNew"], time: sinceUnix }
      );
      if (!auditRes.ok) {
        errors.push(`${account.account_name}: audit fetch page ${page} — ${auditRes.status}`);
        break;
      }
      const json = (await auditRes.json()) as AuditEntry[] | { entries?: AuditEntry[]; data?: AuditEntry[] } | null;
      const entries: AuditEntry[] = Array.isArray(json) ? json : (json?.entries ?? json?.data ?? []);
      if (!entries.length) break;
      auditEntriesScanned += entries.length;
      for (const entry of entries) {
        if (entry?.event) sampleEvents.add(entry.event);
        if (entry.event === "fileResolutionNew" && entry.entityUid) {
          candidateEntityUids.add(entry.entityUid);
        }
      }
      if (entries.length < AUDIT_PER_PAGE) break; // last page
    }
    const candidatesFound = candidateEntityUids.size;

    const currentInviteUids: string[] = [];

    // Candidate entities within an account are independent of each other —
    // fetch their resolutions/invites in parallel rather than serially.
    await Promise.all(
      Array.from(candidateEntityUids).map(async (entityUid) => {
        const resResolutions = await folderitFetch(
          `/v2/accounts/${account.account_uid}/entities/${entityUid}/resolutions`
        );
        if (!resResolutions.ok) return;
        const resolutionsJson = await resResolutions.json();
        const resolutions: FolderitResolution[] = resolutionsJson.resolutions ?? resolutionsJson ?? [];

        const activeResolutions = resolutions.filter(
          (r) => r.status === "active" || r.status === "inProgress"
        );
        if (!activeResolutions.length) return;

        // Fetch the file's real name once per entity (not once per invite).
        // The audit-trail candidate discovery only gives us Folderit's raw
        // uid — showing that directly ("gibberish") was the bug. Joining
        // against folderit_inbox_files only works if the file is still
        // sitting in the inbox; many approval-workflow files have already
        // been filed elsewhere by the time someone's approval is pending,
        // so this fetches the name directly from Folderit instead.
        let fileName: string | null = null;
        try {
          const fileRes = await folderitFetch(`/v2/accounts/${account.account_uid}/files/${entityUid}`);
          if (fileRes.ok) {
            const fileJson = await fileRes.json();
            fileName = fileJson?.name ?? null;
          }
        } catch {
          // leave fileName null — get_folderit_details falls back to the
          // inbox-file join, then finally the raw uid, if this is null.
        }

        for (const resolution of activeResolutions) {
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
              file_uid: entityUid,
              entity_uid: entityUid,
              file_name: fileName,
              account_uid: account.account_uid,
              email: invite.email,
              status: invite.status,
              invite_order: invite.order ?? null,
              // Preserve the invite's real creation date from Folderit so
              // "days pending" reflects when the approval actually started,
              // not when our sync last ran.
              created_at: invite.createdAt ? new Date(invite.createdAt * 1000).toISOString() : null,
              synced_at: new Date().toISOString(),
            });
            if (upsertErr) errors.push(`${account.account_name}: invite upsert — ${upsertErr.message}`);
            else invitesSynced += 1;
          }
        }
      })
    );

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
    return { invitesSynced, errors, auditEntriesScanned, candidatesFound, sampleEvents: Array.from(sampleEvents) };
  } catch (e) {
    errors.push(`${account.account_name}: approval sync error — ${e instanceof Error ? e.message : String(e)}`);
  }

  return { invitesSynced, errors, auditEntriesScanned, candidatesFound: 0, sampleEvents: Array.from(sampleEvents) };
}

type FolderitFolder = {
  uid: string;
  name?: string;
};

type FolderitTeamUser = {
  uid: string;
  email?: string;
  name?: string;
  displayName?: string;
};

async function syncUserMap(
  db: ReturnType<typeof createServiceClient>,
  accounts: AccountMapRow[],
  memberEmails: Set<string>,
  // alias_email (Folderit) → dashboard_email (app login), from folderit_email_aliases
  aliasMap: Map<string, string>
): Promise<{ usersSynced: number; errors: string[] }> {
  const errors: string[] = [];
  let usersSynced = 0;

  await Promise.all(
    accounts.map(async (account) => {
      try {
        // Fetch both team-users (explicit members) and users (includes account
        // owner who doesn't appear in team-users) in parallel, then merge by uid.
        const [teamRes, usersRes] = await Promise.all([
          folderitFetch(`/v2/accounts/${account.account_uid}/team-users?per-page=500`),
          folderitFetch(`/v2/accounts/${account.account_uid}/users?per-page=500`),
        ]);
        if (!teamRes.ok && !usersRes.ok) {
          errors.push(`${account.account_name}: team-users fetch ${teamRes.status}, users fetch ${usersRes.status}`);
          return;
        }
        const teamJson = teamRes.ok ? await teamRes.json() : null;
        const usersJson = usersRes.ok ? await usersRes.json() : null;
        const teamUsers: FolderitTeamUser[] = teamJson?.users ?? teamJson ?? [];
        const allUsers: FolderitTeamUser[] = usersJson?.users ?? usersJson ?? [];
        // Merge, deduplicate by uid
        const byUid = new Map<string, FolderitTeamUser>();
        for (const u of [...teamUsers, ...allUsers]) { if (u.uid) byUid.set(u.uid, u); }
        const users = Array.from(byUid.values());

        const rows = users
          .filter((u) => {
            if (!u.email) return false;
            const fe = u.email.toLowerCase();
            return memberEmails.has(fe) || aliasMap.has(fe);
          })
          .map((u) => {
            const fe = u.email!.toLowerCase();
            // Prefer the alias resolution (dashboard email) over the raw Folderit
            // email so rows are always keyed by the user's app login address.
            const dashboardEmail = aliasMap.get(fe) ?? fe;
            return {
              member_email: dashboardEmail,
              account_uid: account.account_uid,
              folderit_user_uid: u.uid,
              display_name: u.name ?? u.displayName ?? null,
              synced_at: new Date().toISOString(),
            };
          });

        if (rows.length) {
          const { error: upsertErr } = await db
            .from("folderit_user_map")
            .upsert(rows, { onConflict: "member_email,account_uid" });
          if (upsertErr) errors.push(`${account.account_name}: user map upsert — ${upsertErr.message}`);
          else usersSynced += rows.length;
        }
      } catch (e) {
        errors.push(`${account.account_name}: user map error — ${e instanceof Error ? e.message : String(e)}`);
      }
    })
  );

  return { usersSynced, errors };
}

// How deep to recurse into HR subfolders. The "Policies & SOPs" tree has
// nested folders (01-Archive, 02-Policies & SOPs, etc.) — a flat fetch of
// the top folder only picked up its 3 loose files and missed everything
// inside subfolders. Depth is capped to avoid runaway recursion / rate
// limits if Folderit ever returns a folder that references itself.
const HR_MAX_FOLDER_DEPTH = 6;

async function fetchFolderFilesRecursive(
  accountUid: string,
  folderUid: string,
  depth: number,
  errors: string[],
  categoryLabel: string,
  // "/"-joined breadcrumb of subfolder names walked so far, relative to the
  // category's root folder. Empty string at the root itself.
  folderPath: string = ""
): Promise<FolderitFile[]> {
  const collected: FolderitFile[] = [];

  const filesRes = await folderitFetch(
    `/v2/accounts/${accountUid}/folders/${folderUid}/files?per-page=500`
  );
  if (!filesRes.ok) {
    errors.push(`${categoryLabel}: files fetch ${filesRes.status} (folder ${folderUid})`);
  } else {
    const filesJson = await filesRes.json();
    // Folderit's files/folders list endpoints return a bare JSON array per
    // the OpenAPI spec, not a { files: [...] } wrapper — the `?? filesJson`
    // fallback covers that shape defensively either way.
    const files: FolderitFile[] = filesJson.files ?? filesJson ?? [];
    // Stamp each file with the folder path it was found in, so the UI can
    // later show the same folder/subfolder structure Khuram sees inside
    // Folderit itself instead of one flat list.
    collected.push(...files.map((f) => (folderPath ? { ...f, folderPath } : f)));
  }

  if (depth >= HR_MAX_FOLDER_DEPTH) return collected;

  const foldersRes = await folderitFetch(
    `/v2/accounts/${accountUid}/folders/${folderUid}/folders?per-page=500`
  );
  if (!foldersRes.ok) {
    // Not every folder necessarily supports a sub-folders listing the same
    // way — treat this as "no subfolders" rather than a hard error.
    return collected;
  }
  const foldersJson = await foldersRes.json();
  const subfolders: FolderitFolder[] = foldersJson.folders ?? foldersJson ?? [];

  if (subfolders.length) {
    const nested = await Promise.all(
      subfolders.map((sf) => {
        const childPath = folderPath ? `${folderPath}/${sf.name ?? sf.uid}` : (sf.name ?? sf.uid);
        return fetchFolderFilesRecursive(accountUid, sf.uid, depth + 1, errors, categoryLabel, childPath);
      }
      )
    );
    for (const n of nested) collected.push(...n);
  }

  return collected;
}

async function syncHrCategory(
  db: ReturnType<typeof createServiceClient>,
  category: HrCategoryRow
): Promise<{ filesSynced: number; errors: string[] }> {
  const errors: string[] = [];
  let filesSynced = 0;
  const label = `HR/${category.category_name}`;

  try {
    const files = await fetchFolderFilesRecursive(category.account_uid, category.folder_uid, 0, errors, label);

    // De-dupe by file uid in case a file shows up via more than one path.
    const byUid = new Map<string, FolderitFile>();
    for (const f of files) byUid.set(f.uid, f);
    const uniqueFiles = Array.from(byUid.values());

    await db.from("folderit_hr_category_files").delete().eq("category_name", category.category_name);

    if (uniqueFiles.length) {
      const rows = uniqueFiles.map((f) => ({
        file_uid: f.uid,
        category_name: category.category_name,
        name: f.name,
        folder_path: f.folderPath ?? null,
        created_at: f.createdAt ? new Date(f.createdAt * 1000).toISOString() : null,
        synced_at: new Date().toISOString(),
      }));
      const { error: upsertErr } = await db.from("folderit_hr_category_files").upsert(rows);
      if (upsertErr) errors.push(`${label}: upsert — ${upsertErr.message}`);
      else filesSynced = rows.length;
    }
  } catch (e) {
    errors.push(`${label}: fetch error — ${e instanceof Error ? e.message : String(e)}`);
  }

  return { filesSynced, errors };
}

// ── Filing health audit ────────────────────────────────────────────────────
// Runs every sync. Walks each cabinet's Inbox folder to detect:
//   inbox_subfolder  — a subfolder exists inside Inbox (structural problem;
//                      staff are hiding docs in here instead of filing them)
//   buried_in_inbox  — a file is inside one of those Inbox subfolders
//                      (should be in Finance / Legal / HR etc. by now)
//   inbox_stale      — a file has been in Inbox root for >2 days unactioned
//   bad_filename     — filename looks auto-generated or untitled
//
// On each run: all existing issues for the scanned accounts are deleted,
// then the fresh set is inserted. A file that was fixed in Folderit simply
// won't appear in the next scan — no manual "resolve" step needed.

type HealthIssueRow = {
  account_uid: string;
  company_uuid: string | null;
  file_uid: string | null;
  file_name: string;
  issue_type: string;
  location_path: string | null;
  days_old: number | null;
};

const BAD_FILENAME_PATTERNS: RegExp[] = [
  /^scan\d*\./i,
  /^img_?\d+\./i,
  /^dsc\d+\./i,
  /^photo\d*\./i,
  /^screenshot\d*\./i,
  /^document(\s*\(\d+\))?\./i,
  /^untitled(\s*\d*)?\./i,
  /^copy\s+of\s+/i,
  /^new\s+(document|folder|file)/i,
  /^file\d*\./i,
  /^\d+\.(pdf|docx?|xlsx?|pptx?|jpg|png)$/i, // just a number
  /\(\d+\)\.(pdf|docx?|xlsx?|pptx?|jpg|png)$/i, // ends in (1), (2) etc.
];

function isBadFilename(name: string): boolean {
  return BAD_FILENAME_PATTERNS.some((p) => p.test(name.trim()));
}

function daysSince(unixSeconds: number | null | undefined): number | null {
  if (!unixSeconds) return null;
  return Math.floor((Date.now() - unixSeconds * 1000) / (1000 * 60 * 60 * 24));
}

async function scanFilingHealth(
  db: ReturnType<typeof createServiceClient>,
  accounts: AccountMapRow[]
): Promise<{ issuesFound: number; errors: string[] }> {
  const errors: string[] = [];
  const issues: HealthIssueRow[] = [];

  // Look up company_uuid for each account (for role-scoped queries later)
  const { data: companyLinks } = await db
    .from("folderit_account_companies")
    .select("account_uid, company_uuid")
    .in("account_uid", accounts.map((a) => a.account_uid));
  const accountCompany = new Map((companyLinks ?? []).map((r) => [r.account_uid, r.company_uuid as string]));

  // Also pull inbox files we already have synced (avoids an extra Folderit call)
  const { data: inboxRows } = await db
    .from("folderit_inbox_files")
    .select("file_uid, name, created_at, account_uid")
    .in("account_uid", accounts.map((a) => a.account_uid));
  const inboxByAccount = new Map<string, { file_uid: string; name: string; created_at: string | null }[]>();
  for (const row of inboxRows ?? []) {
    const list = inboxByAccount.get(row.account_uid) ?? [];
    list.push(row);
    inboxByAccount.set(row.account_uid, list);
  }

  // Scan each account in parallel (bounded — typically 7 accounts)
  await Promise.all(
    accounts.map(async (account) => {
      if (!account.inbox_folder_uid) return;
      const companyUuid = accountCompany.get(account.account_uid) ?? null;

      try {
        // 1. Detect subfolders inside Inbox — each is a structural violation
        const subfRes = await folderitFetch(
          `/v2/accounts/${account.account_uid}/folders/${account.inbox_folder_uid}/folders?per-page=500`
        );
        const subfJson = subfRes.ok ? await subfRes.json() : null;
        const inboxSubfolders: { uid: string; name: string }[] =
          subfJson?.folders ?? subfJson ?? [];

        for (const subfolder of inboxSubfolders) {
          // Flag the subfolder itself
          issues.push({
            account_uid: account.account_uid,
            company_uuid: companyUuid,
            file_uid: subfolder.uid,
            file_name: subfolder.name,
            issue_type: "inbox_subfolder",
            location_path: `Inbox / ${subfolder.name}`,
            days_old: null,
          });

          // Get files buried inside this subfolder
          const bfRes = await folderitFetch(
            `/v2/accounts/${account.account_uid}/folders/${subfolder.uid}/files?per-page=500`
          );
          const bfJson = bfRes.ok ? await bfRes.json() : null;
          const buried: FolderitFile[] = bfJson?.files ?? bfJson ?? [];

          for (const file of buried) {
            const days = daysSince(file.createdAt);
            // Always buried_in_inbox — may also have a bad filename
            issues.push({
              account_uid: account.account_uid,
              company_uuid: companyUuid,
              file_uid: file.uid,
              file_name: file.name,
              issue_type: "buried_in_inbox",
              location_path: `Inbox / ${subfolder.name}/`,
              days_old: days,
            });
            if (isBadFilename(file.name)) {
              issues.push({
                account_uid: account.account_uid,
                company_uuid: companyUuid,
                file_uid: file.uid,
                file_name: file.name,
                issue_type: "bad_filename",
                location_path: `Inbox / ${subfolder.name}/`,
                days_old: days,
              });
            }
          }
        }

        // 2. Check inbox root files (already in folderit_inbox_files)
        const rootFiles = inboxByAccount.get(account.account_uid) ?? [];
        for (const file of rootFiles) {
          const days = file.created_at
            ? Math.floor((Date.now() - new Date(file.created_at).getTime()) / (1000 * 60 * 60 * 24))
            : null;

          if (isBadFilename(file.name)) {
            issues.push({
              account_uid: account.account_uid,
              company_uuid: companyUuid,
              file_uid: file.file_uid,
              file_name: file.name,
              issue_type: "bad_filename",
              location_path: "Inbox/ (root)",
              days_old: days,
            });
          }
          if (days !== null && days > 2) {
            issues.push({
              account_uid: account.account_uid,
              company_uuid: companyUuid,
              file_uid: file.file_uid,
              file_name: file.name,
              issue_type: "inbox_stale",
              location_path: "Inbox/ (root)",
              days_old: days,
            });
          }
        }
      } catch (e) {
        errors.push(
          `${account.account_name}: health scan — ${e instanceof Error ? e.message : String(e)}`
        );
      }
    })
  );

  // Replace all health issues for these accounts atomically
  await db
    .from("folderit_health_issues")
    .delete()
    .in("account_uid", accounts.map((a) => a.account_uid));

  if (issues.length > 0) {
    // Deduplicate by (account_uid, file_uid, issue_type) before inserting
    const seen = new Set<string>();
    const deduped = issues.filter((iss) => {
      const key = `${iss.account_uid}:${iss.file_uid ?? ""}:${iss.issue_type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    await db.from("folderit_health_issues").insert(deduped);
  }

  return { issuesFound: issues.length, errors };
}

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
  let hrFilesSynced = 0;
  let usersSynced = 0;
  let auditEntriesScanned = 0;
  let candidatesFound = 0;
  const sampleEventsSeen = new Set<string>();

  const { data: accounts, error: accountsErr } = await db
    .from("folderit_account_map")
    .select("account_uid, account_name, scope, inbox_folder_uid")
    .eq("is_active", true)
    .neq("scope", "excluded")
    .neq("scope", "pending");

  if (accountsErr || !accounts?.length) {
    return Response.json({ error: accountsErr?.message ?? "No active Folderit accounts mapped" }, { status: 500 });
  }

  const [{ data: hrCategories }, { data: members }, { data: aliases }] = await Promise.all([
    db.from("folderit_hr_categories").select("category_name, account_uid, folder_uid").eq("is_active", true),
    db.from("members").select("email"),
    // Exclude the admin gmail account — it's covered by isAdmin checks
    // everywhere, so it doesn't need Folderit user map entries. Without
    // this exclusion, k.saleem@unze.co.uk would be ambiguously aliased to
    // both k.saleem@unzegroup.com AND khuram1901@gmail.com, and the Map
    // would resolve to whichever comes last. We always want the CEO account.
    db.from("folderit_email_aliases").select("dashboard_email, alias_email").neq("dashboard_email", "khuram1901@gmail.com"),
  ]);

  const memberEmails = new Set((members ?? []).map((m) => m.email.toLowerCase()));
  // alias_email (Folderit login) → dashboard_email (app login)
  const aliasMap = new Map(
    (aliases ?? []).map((a) => [a.alias_email.toLowerCase(), a.dashboard_email.toLowerCase()])
  );

  // Accounts, HR categories, user mapping, and health audit are all independent — run in parallel.
  const [accountResults, hrResults, userMapResult, healthResult] = await Promise.all([
    Promise.all(
      (accounts as AccountMapRow[]).map(async (account) => {
        const [inbox, approvals] = await Promise.all([
          syncAccountInbox(db, account),
          syncAccountApprovals(db, account),
        ]);
        return { inbox, approvals };
      })
    ),
    Promise.all(((hrCategories ?? []) as HrCategoryRow[]).map((c) => syncHrCategory(db, c))),
    syncUserMap(db, accounts as AccountMapRow[], memberEmails, aliasMap),
    scanFilingHealth(db, accounts as AccountMapRow[]),
  ]);

  for (const { inbox, approvals } of accountResults) {
    inboxSynced += inbox.inboxSynced;
    invitesSynced += approvals.invitesSynced;
    auditEntriesScanned += approvals.auditEntriesScanned;
    candidatesFound += approvals.candidatesFound;
    for (const ev of approvals.sampleEvents) sampleEventsSeen.add(ev);
    errors.push(...inbox.errors, ...approvals.errors);
  }
  for (const hr of hrResults) {
    hrFilesSynced += hr.filesSynced;
    errors.push(...hr.errors);
  }
  usersSynced = userMapResult.usersSynced;
  errors.push(...userMapResult.errors);
  errors.push(...healthResult.errors);

  // Persist a record of this run — previously the debug/error info below
  // only ever lived in this HTTP response, which nothing reads (Vercel
  // cron discards it). That's why folderit_resolution_invites could sit at
  // zero rows indefinitely with no trace of why. Best-effort: a logging
  // failure (e.g. migration not applied yet) must never break the sync
  // itself.
  try {
    await db.from("folderit_sync_log").insert({
      ok: errors.length === 0,
      accounts_synced: accounts.length,
      inbox_files_synced: inboxSynced,
      invites_synced: invitesSynced,
      hr_files_synced: hrFilesSynced,
      users_synced: usersSynced,
      audit_entries_scanned: auditEntriesScanned,
      candidates_found: candidatesFound,
      health_issues_found: healthResult.issuesFound,
      distinct_event_types: Array.from(sampleEventsSeen),
      errors,
    });
  } catch {
    // folderit_sync_log migration not applied yet, or some other
    // logging-only failure — never let this block the actual sync result.
  }

  return Response.json({
    ok: errors.length === 0,
    accountsSynced: accounts.length,
    inboxFilesSynced: inboxSynced,
    invitesSynced,
    hrCategoryFilesSynced: hrFilesSynced,
    usersSynced,
    healthIssuesFound: healthResult.issuesFound,
    debug: {
      auditEntriesScanned,
      candidatesFound,
      distinctEventTypesSeen: Array.from(sampleEventsSeen),
    },
    errors,
  });
}
