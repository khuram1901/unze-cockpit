import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

const BACKUPS_BUCKET = "backups";
const ADMIN_EMAILS = ["khuram1901@gmail.com", "k.saleem@unzegroup.com"];

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  if (!ADMIN_EMAILS.includes(auth.email.toLowerCase())) {
    return Response.json({ error: "Admin only" }, { status: 403 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(BACKUPS_BUCKET)
    .list("", { sortBy: { column: "name", order: "desc" } });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    backups: (data || []).map((f) => ({
      name: f.name,
      sizeKB: f.metadata?.size ? Math.round(f.metadata.size / 1024) : null,
      createdAt: f.created_at,
    })),
  });
}

// Returns a short-lived signed URL for downloading one backup file.
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  if (!ADMIN_EMAILS.includes(auth.email.toLowerCase())) {
    return Response.json({ error: "Admin only" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const filename = body.filename as string | undefined;
  if (!filename) {
    return Response.json({ error: "filename is required" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(BACKUPS_BUCKET)
    .createSignedUrl(filename, 300);

  if (error || !data) {
    return Response.json({ error: error?.message || "Could not create signed URL" }, { status: 500 });
  }

  return Response.json({ url: data.signedUrl });
}
