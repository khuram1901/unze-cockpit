import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { folderitFetch } from "../../../lib/folderit-auth";
import { canViewFolderitHr } from "../../../lib/permissions";
import { loadFolderitUserCtx } from "../_shared";

export const maxDuration = 30; // proxying a large PDF's bytes can take a moment

// Stream a PDF PREVIEW of a Folderit file back to the browser — never the
// original, and never a link the browser downloads. Khuram: "every time I
// click on the documents to view, it downloads the document... I don't
// want people downloading it from the app. I want people to just preview
// it." First attempt just handed back Folderit's own signed preview link
// for the frontend <iframe> to load directly — that still downloaded,
// because Folderit's signed link carries its own Content-Disposition
// baked into the URL's signature (can't be edited without invalidating
// it), and it's set to "attachment", not "inline".
//
// Fix: this route fetches the PDF bytes itself server-side and re-serves
// them with a disposition WE control (always "inline"), so the browser
// has no choice but to render it instead of downloading it. The frontend
// never sees Folderit's real link at all — it gets our proxied response
// as a blob and points an <iframe> at a local blob: URL.
//
// GET /v2/accounts/{accountUid}/files/{fileUid}/preview returns a link to
// a PDF *rendition* of the file (Folderit converts it server-side,
// regardless of original format) — deliberately not the /download
// endpoint, which serves the original file. Response is a 302/303 whose
// Location header (and JSON body) carries that link, never meant to be
// followed as a normal 2xx fetch — hence redirect: "manual" for that
// first call only; the second fetch (of the link itself) follows
// normally to get the actual bytes.
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

    let signedUrl = folderitRes.headers.get("location");
    if (!signedUrl) {
      // Fall back to the JSON body's `url` field — some responses (e.g.
      // watermark processing) carry the link there instead of a header.
      try {
        const json = await folderitRes.json();
        if (json?.url) signedUrl = json.url;
        else if (folderitRes.status === 202) {
          return Response.json(
            { error: "Preview is still being generated — try again in a moment." },
            { status: 202 }
          );
        }
      } catch {
        // no JSON body — signedUrl stays null, handled below
      }
    }

    if (!signedUrl) return Response.json({ error: "Folderit did not return a preview link" }, { status: 502 });

    // Fetch the actual PDF bytes ourselves and re-serve them with an
    // explicit inline disposition — see comment above for why we can't
    // just hand the signed link to the browser directly.
    const pdfRes = await fetch(signedUrl);
    if (!pdfRes.ok) {
      return Response.json({ error: `Couldn't fetch preview content (${pdfRes.status})` }, { status: 502 });
    }

    const contentType = pdfRes.headers.get("content-type") || "application/pdf";
    const buffer = await pdfRes.arrayBuffer();

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (e) {
    return Response.json(
      { error: `Preview fetch failed — ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }
}
