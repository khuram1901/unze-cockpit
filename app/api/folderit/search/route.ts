import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { canViewFolderitHr } from "../../../lib/permissions";
import { loadFolderitUserCtx } from "../_shared";

type InboxRow = { file_uid: string; name: string | null; account_name: string | null; created_at: string | null };
type HrRow = { file_uid: string; name: string | null; category_name: string | null; folder_path: string | null; created_at: string | null };

// Khuram: "one place to log in, and you can search the entire Folder-it
// and get me that document." Two independently-scoped halves, merged:
//   - inbox: every company's unfiled documents. Admin/CEO search all
//     companies; everyone else is scoped to their own company only —
//     same as their approvals/inbox view everywhere else on this page.
//   - hr: HR policy documents + the HR account's own inbox, gated
//     behind can_view_folderit_hr exactly like the rest of HR. Search
//     is just another way to reach the same documents, not a bypass —
//     someone without HR access gets zero HR results back, silently.
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const email = (auth as { email: string }).email.toLowerCase();

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json({ items: [] });

  const db = createServiceClient();

  const [ctx, memberRow] = await Promise.all([
    loadFolderitUserCtx(db, email),
    db.from("members").select("company_id").eq("email", email).maybeSingle(),
  ]);

  const isAdmin = email === "khuram1901@gmail.com" || ctx.role === "Admin" || ctx.role === "CEO";
  const ownCompanyUuid: string | null = memberRow.data?.company_id ?? null;

  // A non-admin with no company_id on their member row must never fall
  // through to "no filter" (that would mean searching every company's
  // inbox) — they just get no inbox results at all. Only an explicit
  // isAdmin grants the NULL/"all companies" search.
  const canSearchInbox = isAdmin || !!ownCompanyUuid;

  const [inboxRes, hrRes] = await Promise.all([
    canSearchInbox
      ? db.rpc("search_folderit_inbox", { p_query: q, p_company_uuid: isAdmin ? null : ownCompanyUuid })
      : Promise.resolve({ data: [] as InboxRow[], error: null }),
    canViewFolderitHr(ctx)
      ? db.rpc("search_folderit_hr_files", { p_query: q })
      : Promise.resolve({ data: [] as HrRow[], error: null }),
  ]);

  if (inboxRes.error) return Response.json({ error: inboxRes.error.message }, { status: 500 });
  if (hrRes.error) return Response.json({ error: hrRes.error.message }, { status: 500 });

  const inboxItems = ((inboxRes.data as InboxRow[] | null) ?? []).map((r) => ({
    file_uid: r.file_uid,
    name: r.name,
    source: "inbox" as const,
    location: r.account_name || "Company inbox",
    created_at: r.created_at,
  }));

  const hrItems = ((hrRes.data as HrRow[] | null) ?? []).map((r) => ({
    file_uid: r.file_uid,
    name: r.name,
    source: "hr" as const,
    location: r.category_name ? (r.folder_path ? `${r.category_name} / ${r.folder_path}` : r.category_name) : "HR — not yet filed",
    created_at: r.created_at,
  }));

  const items = [...inboxItems, ...hrItems]
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    .slice(0, 200);

  return Response.json({ items });
}
