import { NextRequest } from "next/server";
import { google } from "googleapis";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { safeDecrypt, encrypt } from "../../../lib/crypto";

const BACKUPS_BUCKET = "backups";
const ADMIN_EMAILS = ["khuram1901@gmail.com", "k.saleem@unzegroup.com"];
const BACKUP_OWNER = "k.saleem@unzegroup.com";
const DRIVE_FOLDER_NAME = "Unze Cockpit Backups";

async function getDriveLinks(supabase: ReturnType<typeof createServiceClient>): Promise<{
  folderLink: string | null;
  files: Record<string, string>; // filename → webViewLink
}> {
  try {
    const { data: token } = await supabase
      .from("google_oauth_tokens")
      .select("id, access_token, refresh_token, token_expiry")
      .eq("user_email", BACKUP_OWNER)
      .single();

    if (!token) return { folderLink: null, files: {} };

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      (process.env.GOOGLE_REDIRECT_URI || "").replace("/callback", "/callback-notifications")
    );
    oauth2Client.setCredentials({
      access_token:  safeDecrypt(token.access_token),
      refresh_token: safeDecrypt(token.refresh_token),
      expiry_date:   token.token_expiry ? new Date(token.token_expiry).getTime() : undefined,
    });

    oauth2Client.on("tokens", async (newTokens) => {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (newTokens.access_token) updates.access_token = encrypt(newTokens.access_token);
      if (newTokens.expiry_date)  updates.token_expiry = new Date(newTokens.expiry_date).toISOString();
      await supabase.from("google_oauth_tokens").update(updates).eq("id", token.id);
    });

    const drive = google.drive({ version: "v3", auth: oauth2Client });

    // Find the backup folder
    const folderSearch = await drive.files.list({
      q: `name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id, webViewLink)",
      spaces: "drive",
    });

    const folder = folderSearch.data.files?.[0];
    if (!folder?.id) return { folderLink: null, files: {} };

    // List files in the folder
    const fileList = await drive.files.list({
      q: `'${folder.id}' in parents and trashed=false`,
      fields: "files(name, webViewLink)",
      orderBy: "name desc",
      pageSize: 100,
    });

    const files: Record<string, string> = {};
    for (const f of fileList.data.files || []) {
      if (f.name && f.webViewLink) files[f.name] = f.webViewLink;
    }

    return { folderLink: folder.webViewLink || null, files };
  } catch {
    return { folderLink: null, files: {} };
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  if (!ADMIN_EMAILS.includes(auth.email.toLowerCase())) {
    return Response.json({ error: "Admin only" }, { status: 403 });
  }

  const supabase = createServiceClient();

  const [storageResult, driveResult] = await Promise.all([
    supabase.storage.from(BACKUPS_BUCKET).list("", { sortBy: { column: "name", order: "desc" } }),
    getDriveLinks(supabase),
  ]);

  if (storageResult.error) {
    return Response.json({ error: storageResult.error.message }, { status: 500 });
  }

  return Response.json({
    driveFolderLink: driveResult.folderLink,
    backups: (storageResult.data || []).map((f) => ({
      name: f.name,
      sizeKB: f.metadata?.size ? Math.round(f.metadata.size / 1024) : null,
      createdAt: f.created_at,
      driveLink: driveResult.files[f.name] || null,
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
