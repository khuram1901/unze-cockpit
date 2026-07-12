import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { folderitFetch } from "../../../lib/folderit-auth";
import { canViewFolderitHr } from "../../../lib/permissions";
import { loadFolderitUserCtx } from "../_shared";

export const maxDuration = 60; // conversion-heavy files (xlsx, docx) can take a while to render to PDF

// How many times to poll Folderit while it's still generating the PDF
// rendition, and how long to wait between polls (clamped — Folderit's own
// retryAfter is honoured within these bounds).
const MAX_PREVIEW_POLLS = 8;
const MIN_POLL_DELAY_MS = 1000;
const MAX_POLL_DELAY_MS = 3000;

type PreviewLinkResult =
  | { kind: "url"; url: string }
  | { kind: "retry"; delayMs: number }
  | { kind: "error"; message: string; status: number };

async function requestFolderitPreviewLink(accountUid: string, fileUid: string): Promise<PreviewLinkResult> {
  const res = await folderitFetch(`/v2/accounts/${accountUid}/files/${fileUid}/preview`, {
    redirect: "manual",
  });

  const location = res.headers.get("location");
  if (location) return { kind: "url", url: location };

  // Read as text first (a body can only be consumed once) so a non-JSON
  // error body from Folderit is still visible in the error case below,
  // instead of being silently swallowed by a failed .json() parse.
  const rawBody = await res.text().catch(() => null);
  let json: Record<string, unknown> | null = null;
  if (rawBody) {
    try {
      json = JSON.parse(rawBody);
    } catch {
      // not JSON — rawBody stays as-is for the error message below
    }
  }

  if (typeof json?.url === "string") return { kind: "url", url: json.url };

  // 202 = still generating the PDF rendition. Office formats (Excel,
  // Word) need an actual conversion pass and can take several seconds;
  // native PDFs resolve instantly and never hit this branch. Folderit
  // tells us how long to wait via Retry-After / retryAfter.
  if (res.status === 202 || res.status === 303) {
    const headerDelay = Number(res.headers.get("retry-after"));
    const bodyDelay = typeof json?.retryAfter === "number" ? json.retryAfter : NaN;
    const delaySec = !isNaN(bodyDelay) ? bodyDelay : !isNaN(headerDelay) ? headerDelay : 2;
    const delayMs = Math.min(Math.max(delaySec * 1000, MIN_POLL_DELAY_MS), MAX_POLL_DELAY_MS);
    return { kind: "retry", delayMs };
  }

  // Surface exactly what Folderit said instead of a generic message — the
  // status/body tells us whether this is permissions (403), a
  // deleted/moved file (404), an unsupported type for PDF conversion
  // (400), or something else entirely.
  return {
    kind: "error",
    message: `Folderit didn't return a preview link (${res.status}${res.statusText ? " " + res.statusText : ""})${rawBody ? `: ${rawBody.slice(0, 300)}` : ""}`,
    status: 502,
  };
}

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
    // Poll until Folderit finishes converting the file to a PDF rendition.
    // Khuram: "i noticed it was applying to files which are .xlxs excel
    // files not pdf as they work fine" — confirms this: native PDFs need
    // no conversion and resolve on the first request, but Excel/Word
    // files go through an actual conversion pass and were hitting 202
    // ("still generating") on that first request, which the old code
    // treated as a dead end instead of waiting and asking again.
    let signedUrl: string | null = null;
    for (let attempt = 0; attempt < MAX_PREVIEW_POLLS; attempt++) {
      const result = await requestFolderitPreviewLink(accountUid, fileUid);
      if (result.kind === "url") {
        signedUrl = result.url;
        break;
      }
      if (result.kind === "error") {
        return Response.json({ error: result.message }, { status: result.status });
      }
      // result.kind === "retry"
      if (attempt === MAX_PREVIEW_POLLS - 1) {
        return Response.json(
          { error: "Preview is taking longer than usual to generate (large file?) — try again in a moment." },
          { status: 202 }
        );
      }
      await new Promise((resolve) => setTimeout(resolve, result.delayMs));
    }

    if (!signedUrl) {
      return Response.json({ error: "Folderit didn't return a preview link in time." }, { status: 502 });
    }

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
