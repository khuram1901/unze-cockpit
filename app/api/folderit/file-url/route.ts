import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { folderitFetch } from "../../../lib/folderit-auth";

// Resolve a live, time-limited link to view/download a Folderit file.
// Frontend only ever needs the file_uid it already has from a details/HR
// list — this route looks up which Folderit account the file lives in via
// get_folderit_file_account(), checks the caller is allowed to see it, then
// asks Folderit for a download link and hands back just the URL.
//
// GET /v2/accounts/{accountUid}/files/{fileUid}/download responds with a
// 302/303 whose Location header (and JSON body) carries the real link —
// it's never meant to be followed as a normal 2xx fetch, so this uses
// redirect: "manual" and reads the Location header directly.
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
    // HR documents are visible to everyone regardless of company (same
    // rule as get_folderit_hr_category_files). Everything else is scoped
    // to the caller's own company.
    const { data: hrMatch } = await db
      .from("folderit_hr_categories")
      .select("category_name")
      .eq("account_uid", accountUid)
      .limit(1)
      .maybeSingle();

    if (!hrMatch) {
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
    const folderitRes = await folderitFetch(`/v2/accounts/${accountUid}/files/${fileUid}/download`, {
      redirect: "manual",
    });

    const location = folderitRes.headers.get("location");
    if (location) return Response.json({ url: location });

    // Fall back to the JSON body's `url` field — some responses (e.g.
    // watermark processing) carry the link there instead of a header.
    try {
      const json = await folderitRes.json();
      if (json?.url) return Response.json({ url: json.url });
    } catch {
      // no JSON body — fall through to the error below
    }

    return Response.json({ error: "Folderit did not return a file link" }, { status: 502 });
  } catch (e) {
    return Response.json(
      { error: `File link fetch failed — ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }
}
