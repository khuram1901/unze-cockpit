import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { folderitFetch } from "../../../lib/folderit-auth";
import { canViewFolderitHr } from "../../../lib/permissions";
import { loadFolderitUserCtx } from "../_shared";

// Resolve a live, time-limited link to PREVIEW a Folderit file — never the
// original for download. Khuram: "every time I click on the documents to
// view, it downloads the document... Can you enable a preview function...
// I don't want people downloading it from the app."
//
// Frontend only ever needs the file_uid it already has from a details/HR
// list — this route looks up which Folderit account the file lives in via
// get_folderit_file_account(), checks the caller is allowed to see it, then
// asks Folderit for a preview link and hands back just the URL.
//
// GET /v2/accounts/{accountUid}/files/{fileUid}/preview returns a link to a
// PDF *rendition* of the file (Folderit converts it server-side, regardless
// of original format) — deliberately not the /download endpoint, which
// serves the original file and is what was triggering the browser's
// download prompt. Same response shape as /download: a 302/303 whose
// Location header (and JSON body) carries the real link, never meant to be
// followed as a normal 2xx fetch — hence redirect: "manual".
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const email = (auth as { email: string }).email.toLowerCase();

  const fileUid = request.nextUrl.searchParams.get("file");
  if (!fileUid) return Response.json({ error: "Missing file" }, { status: 400 });

  const db = createServiceClient();

  const { data: accountUid, error: lookupErr } = await db.rpc("get_folderit_file_account", {
    p_file_uid: fileUid,
  });
  if (lookupErr) return Response.json({ error: lookupErr.message }, { status: 500 });
  if (!accountUid) return Response.json({ error: "File not found" }, { status: 404 });

  const { data: member } = await db
    .from("members")
    .select("role, company_id")
    .eq("email", email)
    .maybeSingle();

  const isAdmin =
    email === "khuram1901@gmail.com" ||
    member?.role === "Admin" ||
    member?.role === "CEO";

  if (!isAdmin) {
    // HR documents are locked behind can_view_folderit_hr (off by default,
    // granted per-member via Members > Access Matrix > Folderit > HR).
    // Everything else is scoped to the caller's own company, as before.
    const { data: hrMatch } = await db
      .from("folderit_hr_categories")
      .select("category_name")
      .eq("account_uid", accountUid)
      .limit(1)
      .maybeSingle();

    if (hrMatch) {
      const ctx = await loadFolderitUserCtx(db, email);
      if (!canViewFolderitHr(ctx)) return Response.json({ error: "Forbidden" }, { status: 403 });
    } else {
      const { data: companyMatch } = await db
        .from("folderit_account_companies")
        .select("company_uuid")
        .eq("account_uid", accountUid)
        .eq("company_uuid", member?.company_id ?? "")
        .maybeSingle();
      if (!companyMatch) return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const folderitRes = await folderitFetch(`/v2/accounts/${accountUid}/files/${fileUid}/preview`, {
      redirect: "manual",
    });

    const location = folderitRes.headers.get("location");
    if (location) return Response.json({ url: location });

    // Fall back to the JSON body's `url` field — some responses (e.g.
    // watermark processing) carry the link there instead of a header.
    try {
      const json = await folderitRes.json();
      if (json?.url) return Response.json({ url: json.url });
      // 202 = PDF rendition is still being generated, no link yet.
      if (folderitRes.status === 202) {
        return Response.json({ error: "Preview is still being generated — try again in a moment." }, { status: 202 });
      }
    } catch {
      // no JSON body — fall through to the error below
    }

    return Response.json({ error: "Folderit did not return a preview link" }, { status: 502 });
  } catch (e) {
    return Response.json(
      { error: `File link fetch failed — ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }
}
